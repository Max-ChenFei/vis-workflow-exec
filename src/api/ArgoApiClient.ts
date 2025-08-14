import { ArgoRestApiResponse, WorkflowStatus} from './types';
import { WorkflowWatcher } from './WorkflowWatcher';

class ArgoApiClient {
  private namespace: string = 'argo';
  private workflowWatcher: WorkflowWatcher;

  constructor() {
    this.workflowWatcher = new WorkflowWatcher(this.namespace);
  }

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    expectJson: boolean = true
  ): Promise<T> {
    const headers: HeadersInit = {};
    headers['Accept'] = 'application/json';
    const config: RequestInit = {
      method: method,
      headers: headers,
      mode: 'cors',
      credentials: 'same-origin',
    };

    if (data) {
      headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(data);
    }
    
    const response = await fetch(path, config);

    if (!response.ok) {
      const err: any = new Error('');
      err.status = response.status;
      err.msg = response.statusText;
      throw err;
    }

    if (expectJson) {
      const result = await response.json();
      return result as T;
    } else {
      const result = await response.text();
      return result as T;
    }
  }

  public async checkHealth(): Promise<{ isHealthy: boolean; error?: string, status?: number }> {
    const path = `/api/v1/workflows/${this.namespace}?limit=1`;
    try {
      const response = await this.request<ArgoRestApiResponse>('GET', path, undefined, true);
      return { isHealthy: !!response };
    } catch (e: any) {
      return { isHealthy: false, error: e?.msg || 'Unknown error', status: e?.status};
    }
  }
  
  public async submitWorkflow(
    workflowManifest: any
  ): Promise<ArgoRestApiResponse> {
    const path = `/api/v1/workflows/${this.namespace}`;

    const requestBody = {
      workflow: workflowManifest
    };
    
    return this.request<ArgoRestApiResponse>('POST', path, requestBody);
  }

  public async listWorkflows(): Promise<ArgoRestApiResponse> {
    const path = `/api/v1/workflows/${this.namespace}`;
    return this.request<ArgoRestApiResponse>('GET', path);
  }

  public async deleteAllWorkflows(): Promise<{ deleted: number; errors: string[] }> {
    const result = { deleted: 0, errors: [] as string[] };
    
    try {
      const response = await this.listWorkflows();
      
      if (!response.items || response.items.length === 0) {
        return result;
      }
      
      for (const workflow of response.items) {
        if (!workflow.metadata?.name) {
          result.errors.push(`Workflow missing name: ${JSON.stringify(workflow.metadata)}`);
          continue;
        }
        
        try {
          const name = workflow.metadata.name;
          const path = `/api/v1/workflows/${this.namespace}/${name}`;
          await this.request<void>('DELETE', path);
          result.deleted++;
        } catch (error: any) {
          const errorMessage = `Failed to delete workflow ${workflow.metadata?.name}: ${error.message}`;
          result.errors.push(errorMessage);
        }
      }
      
      return result;
    } catch (error: any) {
      const errorMessage = `Failed to list or delete workflows: ${error.message}`;
      result.errors.push(errorMessage);
      return result;
    }
  }

  public watchWorkflow(
    workflowName: string,
    onUpdate: (data: WorkflowStatus) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void,
    onClose?: () => void
  ): () => void {
    return this.workflowWatcher.watch(workflowName, onUpdate, onOpen, onClose, onError);
  }

  public stopWatchingWorkflow(): void {
    this.workflowWatcher.stop();
  }
}

export default ArgoApiClient;
