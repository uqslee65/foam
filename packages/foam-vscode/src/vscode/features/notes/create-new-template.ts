import { commands, ExtensionContext } from 'vscode';
import { createTemplate } from '../../../vscode/services/template-service';

export default async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('pa-hub.create-new-template', createTemplate)
  );
}
