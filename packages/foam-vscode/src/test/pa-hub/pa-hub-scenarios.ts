export interface ScenarioResult {
  readonly channel: 'workbench' | 'privacy' | 'csp';
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface WorkbenchScenario {
  readonly name: string;
  readonly channel: 'workbench';
  readonly description: string;
}

export interface PrivacyScenario {
  readonly name: string;
  readonly channel: 'privacy';
  readonly sentinel: string;
  readonly surfaces: readonly string[];
}

export interface CspScenario {
  readonly name: string;
  readonly channel: 'csp';
  readonly description: string;
}

export type PaHubScenario = WorkbenchScenario | PrivacyScenario | CspScenario;

export function getWorkbenchScenarios(): readonly WorkbenchScenario[] {
  return [
    { name: 'sidebar-visible', channel: 'workbench', description: 'PA Hub sidebar container is visible' },
    { name: 'graph-groups', channel: 'workbench', description: 'Both vault and sources graph groups render' },
    { name: 'node-opening', channel: 'workbench', description: 'Graph node click opens the document' },
    { name: 'command-registration', channel: 'workbench', description: 'PA Hub commands are registered' },
    { name: 'task-persistence', channel: 'workbench', description: 'Task checkbox state persists across reloads' },
  ];
}

export function getPrivacyScenarios(): readonly PrivacyScenario[] {
  return [
    {
      name: 'graph-sentinel',
      channel: 'privacy',
      sentinel: 'PA_HUB_PRIVATE_SENTINEL_V1',
      surfaces: ['graph-nodes', 'search-results', 'webview-html', 'messages'],
    },
    {
      name: 'capture-sentinel',
      channel: 'privacy',
      sentinel: 'PA_HUB_PRIVATE_SENTINEL_V1',
      surfaces: ['captured-output', 'inherited-surfaces'],
    },
  ];
}

export function getCspScenarios(): readonly CspScenario[] {
  return [
    { name: 'block-injected-script', channel: 'csp', description: 'Injected script tag is blocked by CSP' },
    { name: 'block-external-fetch', channel: 'csp', description: 'External fetch from webview is blocked' },
    { name: 'local-assets-allowed', channel: 'csp', description: 'Local extension assets load under CSP' },
    { name: 'no-violations', channel: 'csp', description: 'No unexpected CSP violation reports' },
  ];
}

export function getAllScenarios(): readonly PaHubScenario[] {
  return [...getWorkbenchScenarios(), ...getPrivacyScenarios(), ...getCspScenarios()];
}
