import { Disposable, workspace } from 'vscode';
import { IFoamConfig } from '@foam/core';
import { expandAlternateGroups } from './utils/glob-expand';

/**
 * Paths that are never knowledge base content, excluded regardless of
 * configuration.
 *
 * `pa-hub.files.exclude` is an array setting, so a user value replaces the
 * default instead of extending it — anything left to that default disappears
 * the moment someone adds a single pattern of their own.
 *
 * The VCS entries are spelled `/**` rather than VS Code's bare `**\/.git`
 * because these patterns are also matched with micromatch (see `GlobMatcher`),
 * where a bare directory name matches the directory itself and nothing under
 * it. VS Code's own search engine prunes the folder either way.
 */
const ALWAYS_EXCLUDED = [
  '**/.foam/**',
  '**/.git/**',
  '**/.hg/**',
  '**/.svn/**',
  '**/.DS_Store',
  '**/Thumbs.db',
];

export class VsCodeFoamConfig implements IFoamConfig {
  getFilesInclude(): string[] {
    return workspace
      .getConfiguration()
      .get('pa-hub.files.include', ['**/*'])
      .flatMap(expandAlternateGroups);
  }

  getFilesExclude(): string[] {
    return [
      ...ALWAYS_EXCLUDED,
      ...workspace.getConfiguration().get('pa-hub.files.exclude', []),
      ...workspace.getConfiguration().get('pa-hub.files.ignore', []),
      ...Object.keys(workspace.getConfiguration().get('files.exclude', {})),
    ].flatMap(expandAlternateGroups);
  }

  getDefaultNoteExtension(): string {
    return (
      '.' +
      (
        workspace
          .getConfiguration('pa-hub')
          .get('files.defaultNoteExtension', 'md') ?? 'md'
      ).trim()
    );
  }

  getNotesExtensions(): string[] {
    const defaultExtension = this.getDefaultNoteExtension();
    const extras = workspace
      .getConfiguration('pa-hub')
      .get('files.notesExtensions', '')
      .split(' ')
      .map((e: string) => e.trim())
      .filter((e: string) => e !== '')
      .map((e: string) => '.' + e);
    return [...new Set([...extras, defaultExtension])];
  }

  getAttachmentExtensions(): string[] {
    return workspace
      .getConfiguration('pa-hub')
      .get(
        'files.attachmentExtensions',
        'pdf mp3 webm wav m4a mp4 avi mov rtf txt doc docx pages xls xlsx numbers ppt pptm pptx'
      )
      .split(' ')
      .map((e: string) => '.' + e.trim());
  }

  getNewNotePath(): 'root' | 'currentDir' {
    return workspace
      .getConfiguration('pa-hub')
      .get('files.newNotePath', 'root') as 'root' | 'currentDir';
  }

  getTemplatesFolder(): string {
    return workspace
      .getConfiguration('pa-hub')
      .get('templates.folder', '.foam/templates');
  }

  getDailyNoteDirectory(): string | null {
    return (
      workspace
        .getConfiguration('pa-hub')
        .get<string | null>('openDailyNote.directory', null) ?? null
    );
  }

  getDailyNoteFilenameFormat(): string {
    return workspace
      .getConfiguration('pa-hub')
      .get('openDailyNote.filenameFormat', 'isoDate');
  }

  getDailyNoteFileExtension(): string {
    return workspace
      .getConfiguration('pa-hub')
      .get('openDailyNote.fileExtension', 'md');
  }

  getDailyNoteTitleFormat(): string | null {
    return (
      workspace
        .getConfiguration('pa-hub')
        .get<string | null>('openDailyNote.titleFormat', null) ?? null
    );
  }

  getOpenDailyNoteOnStartup(): boolean {
    return workspace
      .getConfiguration('pa-hub')
      .get('openDailyNote.onStartup', false);
  }

  getDateLocale(): string {
    return workspace.getConfiguration('pa-hub').get('dateLocale', 'default');
  }

  getDateSnippetsAfterCompletion(): 'noop' | 'createNote' | 'navigateToNote' {
    return workspace
      .getConfiguration('pa-hub')
      .get('dateSnippets.afterCompletion', 'createNote') as
      | 'noop'
      | 'createNote'
      | 'navigateToNote';
  }

  getLinksDirectoryMode(): 'resolve' | 'disabled' {
    return workspace
      .getConfiguration('pa-hub')
      .get('links.directory.mode', 'resolve') as 'resolve' | 'disabled';
  }

  getLinksSyncEnable(): boolean {
    return workspace.getConfiguration('pa-hub').get('links.sync.enable', true);
  }

  getLinksHoverEnable(): boolean {
    return workspace.getConfiguration('pa-hub').get('links.hover.enable', true);
  }

  getEditLinkReferenceDefinitions():
    | 'withExtensions'
    | 'withoutExtensions'
    | 'off' {
    return workspace
      .getConfiguration('pa-hub')
      .get('edit.linkReferenceDefinitions', 'off') as
      | 'withExtensions'
      | 'withoutExtensions'
      | 'off';
  }

  getCompletionLabel(): 'path' | 'title' | 'identifier' {
    return workspace
      .getConfiguration('pa-hub')
      .get('completion.label', 'path') as 'path' | 'title' | 'identifier';
  }

  getCompletionUseAlias(): 'never' | 'whenPathDiffersFromTitle' {
    return workspace
      .getConfiguration('pa-hub')
      .get('completion.useAlias', 'never') as
      | 'never'
      | 'whenPathDiffersFromTitle';
  }

  getCompletionLinkFormat(): 'wikilink' | 'link' {
    return workspace
      .getConfiguration('pa-hub')
      .get('completion.linkFormat', 'wikilink') as 'wikilink' | 'link';
  }

  getPreviewEmbedNoteType():
    | 'full-inline'
    | 'full-card'
    | 'content-inline'
    | 'content-card' {
    return workspace
      .getConfiguration('pa-hub')
      .get('preview.embedNoteType', 'full-card') as
      | 'full-inline'
      | 'full-card'
      | 'content-inline'
      | 'content-card';
  }

  getGraphOnStartup(): boolean {
    return workspace.getConfiguration('pa-hub').get('graph.onStartup', false);
  }

  getGraphNavigateToPreview(): boolean {
    return workspace
      .getConfiguration('pa-hub')
      .get('graph.navigateToPreview', false);
  }

  getGraphTitleMaxLength(): number {
    return workspace.getConfiguration('pa-hub').get('graph.titleMaxLength', 24);
  }

  getGraphStyle(): object {
    return workspace.getConfiguration('pa-hub').get('graph.style', {});
  }

  getSupportedLanguages(): string[] {
    return workspace
      .getConfiguration('pa-hub')
      .get('supportedLanguages', ['markdown']);
  }
}

export interface ConfigurationMonitor<T> extends Disposable {
  (): T;
}

export const getFoamVsCodeConfig = <T>(key: string, defaultValue?: T): T =>
  workspace.getConfiguration('pa-hub').get(key, defaultValue);

export const updateFoamVsCodeConfig = <T>(key: string, value: T) =>
  workspace.getConfiguration().update('pa-hub.' + key, value);

export const monitorFoamVsCodeConfig = <T>(
  key: string
): ConfigurationMonitor<T> => {
  let value: T = getFoamVsCodeConfig(key);
  const listener = workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('pa-hub.' + key)) {
      value = getFoamVsCodeConfig(key);
    }
  });
  const ret = () => {
    return value;
  };
  ret.dispose = () => listener.dispose();
  return ret;
};
