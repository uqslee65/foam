/*global markdownit:readonly*/

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  workspace,
  ExtensionContext,
  window,
  commands,
  RelativePattern,
} from 'vscode';
import {
  MarkdownResourceProvider,
  Logger,
  Config,
  LoadProfiler,
  EventLoopMonitor,
  formatMemoryUsage,
} from '@foam/core';
import { bootstrap } from './core/model/foam';
import { fromVsCodeUri } from './vscode/utils/vsc-utils';

import { features } from './vscode/features';
import { FoamFeatureResult } from './types';
import { VsCodeOutputLogger, exposeLogger } from './vscode/services/logging';
import { VsCodeFoamConfig } from './vscode/config';
import { AttachmentResourceProvider } from '@foam/core';
import { VsCodeWatcher } from './vscode/services/watcher';
import { createMarkdownParser } from '@foam/core';
import VsCodeBasedParserCache from './vscode/services/cache';
import { createMatcherAndDataStore } from './vscode/services/editor';
import { createPrivacyPolicy } from './pa-hub/privacy';
import { withPrivacy } from './pa-hub/privacy-index';
import { activatePaHub } from './pa-hub/activate';
import { buildWorkspaceWatchGlob } from './vscode/utils/watch-glob';
import { OllamaEmbeddingProvider } from './ai/providers/ollama/ollama-provider';

export async function activate(context: ExtensionContext) {
  const logger = new VsCodeOutputLogger();
  Logger.setDefaultLogger(logger);
  exposeLogger(context, logger);

  Config.setDefaultConfig(new VsCodeFoamConfig());
  try {
    Logger.info('Starting Foam');

    if (workspace.workspaceFolders === undefined) {
      Logger.info('No workspace open. Foam will not start');
      return;
    }

    // Prepare Foam
    const includes = Config.getFilesInclude();
    const excludes = Config.getFilesExclude();
    const {
      matcher,
      dataStore: rawDataStore,
      includePatterns,
      excludePatterns,
    } = await createMatcherAndDataStore(includes, excludes);

    Logger.info('Loading from directories:');
    for (const folder of workspace.workspaceFolders) {
      Logger.info('- ' + folder.uri.fsPath);
      Logger.info('  Include: ' + includePatterns.get(folder.name).join(','));
      Logger.info('  Exclude: ' + excludePatterns.get(folder.name).join(','));
    }

    const excludeGlobs = workspace
      .getConfiguration('pa-hub')
      .get<string[]>('privacy.excludeGlobs', []);
    const privacyPolicy = createPrivacyPolicy({
      roots: workspace.workspaceFolders.map(f => f.uri.fsPath),
      excludeGlobs,
    });
    const { matcher: privacyMatcher, dataStore: privacyDataStore } =
      withPrivacy(privacyPolicy, matcher, rawDataStore);

    const notesExtensions = Config.getNotesExtensions();
    const defaultExtension = Config.getDefaultNoteExtension();
    const attachmentProvider = new AttachmentResourceProvider(
      Config.getAttachmentExtensions()
    );

    const watchGlob = buildWorkspaceWatchGlob(
      notesExtensions,
      attachmentProvider
    );
    const watcher = new VsCodeWatcher(
      workspace.workspaceFolders.map(folder =>
        workspace.createFileSystemWatcher(
          new RelativePattern(folder.uri, watchGlob)
        )
      ),
      workspace.onDidSaveTextDocument
    );
    context.subscriptions.push(watcher);
    // Attributes the workspace load time to reading vs parsing vs neither, so
    // that a slow startup reported by a user can be diagnosed from the log
    // alone. See issue #1689.
    const profiler = new LoadProfiler();
    const eventLoopMonitor = new EventLoopMonitor();

    const dataStore = profiler.instrumentDataStore(privacyDataStore);

    const parserCache = await VsCodeBasedParserCache.create(context);
    context.subscriptions.push(parserCache);
    const parser = createMarkdownParser([], parserCache, profiler.onParse);

    const workspaceRoots =
      workspace.workspaceFolders?.map(folder => fromVsCodeUri(folder.uri)) ??
      [];

    const directoryMode = Config.getLinksDirectoryMode();
    const markdownProvider = new MarkdownResourceProvider(
      dataStore,
      parser,
      notesExtensions,
      directoryMode
    );

    context.subscriptions.push(markdownProvider, attachmentProvider);

    // Initialize embedding provider
    const experimentalEnabled = workspace
      .getConfiguration('pa-hub')
      .get('experimental');
    const embeddingProvider = experimentalEnabled
      ? new OllamaEmbeddingProvider()
      : undefined;

    profiler.start();
    eventLoopMonitor.start();

    const foamPromise = bootstrap(
      workspaceRoots,
      privacyMatcher,
      watcher,
      dataStore,
      parser,
      [markdownProvider, attachmentProvider],
      defaultExtension,
      embeddingProvider
    );

    // Load the features
    const featuresPromises = features.map(feature =>
      feature(context, foamPromise)
    );

    const foam = await foamPromise;
    // Register for disposal right away: a feature failing to load further
    // down must not leave the workspace/graph/watchers alive and untracked
    context.subscriptions.push(foam);
    profiler.stop();
    eventLoopMonitor.stop();

    const resources = foam.workspace.list();
    const noteCount = resources.filter(r => r.type === 'note').length;
    const attachmentCount = resources.filter(
      r => r.type === 'image' || r.type === 'attachment'
    ).length;
    Logger.info(`Loaded ${resources.length} resources`);
    Logger.info(
      profiler.formatReport({
        resources: `${resources.length} (${noteCount} notes, ${attachmentCount} attachments) from ${workspace.workspaceFolders.length} folder(s)`,
        'event loop': eventLoopMonitor.format(),
        memory: formatMemoryUsage(),
      })
    );

    // One broken feature must degrade that feature only, not abort the whole
    // activation (which would also skip extendMarkdownIt for every feature)
    const settled = await Promise.allSettled(featuresPromises);
    settled.forEach((result, i) => {
      if (result.status === 'rejected') {
        Logger.error(
          `Feature #${i} (${
            features[i].name || 'anonymous'
          }) failed to activate`,
          result.reason
        );
      }
    });
    const feats = settled
      .filter(
        (r): r is PromiseFulfilledResult<FoamFeatureResult | void> =>
          r.status === 'fulfilled'
      )
      .map(r => r.value)
      .filter((r): r is FoamFeatureResult => r != null);

    context.subscriptions.push(
      commands.registerCommand('pa-hub.clear-cache', () => parserCache.clear()),
      workspace.onDidChangeConfiguration(e => {
        if (
          [
            'pa-hub.files.ignore',
            'pa-hub.files.exclude',
            'pa-hub.files.include',
            'pa-hub.files.attachmentExtensions',
            'pa-hub.files.noteExtensions',
            'pa-hub.files.defaultNoteExtension',
          ].some(setting => e.affectsConfiguration(setting))
        ) {
          window.showInformationMessage(
            'Foam: Reload the window to use the updated settings'
          );
        }
      })
    );

    // Tasks tree
    const tasksCandidates = [
      path.join(os.homedir(), 'projects', 'export-setup', 'personal-assistant-copy', 'tasks-repo'),
      path.join(os.homedir(), 'research-sources', 'tasks-repo'),
    ];
    const wsRoot = workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) tasksCandidates.push(path.join(wsRoot, 'tasks-repo'));
    const tasksDir = tasksCandidates.find(d => fs.existsSync(d)) ?? tasksCandidates[0];
    activatePaHub(context, tasksDir, privacyPolicy);

    return {
      extendMarkdownIt: (md: markdownit) => {
        return feats.reduce((acc: markdownit, r) => {
          return r.extendMarkdownIt ? r.extendMarkdownIt(acc) : acc;
        }, md);
      },
      foam,
    };
  } catch (e) {
    Logger.error('An error occurred while bootstrapping Foam', e);
    window.showErrorMessage(
      `An error occurred while bootstrapping Foam. ${e.stack}`
    );
  }
}
