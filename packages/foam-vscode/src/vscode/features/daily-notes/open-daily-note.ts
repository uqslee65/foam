import { ExtensionContext, commands } from 'vscode';
import { getFoamVsCodeConfig } from '../../../vscode/config';
import { openDailyNoteFor } from './daily-note-service';
import { Foam } from '@foam/core';
import { getTelemetry } from '../../services/telemetry';

export default async function activate(
  context: ExtensionContext,
  foamPromise: Promise<Foam>
) {
  context.subscriptions.push(
    commands.registerCommand('pa-hub.open-daily-note', async () => {
      getTelemetry()?.trackCommand('pa-hub.open-daily-note');
      return openDailyNoteFor(new Date(), await foamPromise);
    })
  );

  if (getFoamVsCodeConfig('openDailyNote.onStartup', false)) {
    commands.executeCommand('pa-hub.open-daily-note');
  }
}
