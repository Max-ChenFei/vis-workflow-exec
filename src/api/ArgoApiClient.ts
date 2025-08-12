import { WorkflowManifest, WorkflowResponse, ApiResponse, ArgoClientError } from '../types/argo';

class ArgoApiClient {
  private authToken: string | null;
  private namespace: string;

  constructor( authToken: string | null = null, defaultNamespace: string = 'default') {
    this.authToken = authToken;
    this.namespace = defaultNamespace;
  }

  public setAuthToken(token: string): void {
    token = token.trim();
    this.authToken = token;
  }

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    expectJson: boolean = true
  ): Promise<T> {
    const headers: HeadersInit = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
  headers['Accept'] = 'application/json';
    const config: RequestInit = {
      method: method,
      headers: headers,
      mode: 'cors',
      credentials: 'same-origin',
    };

    if (data) {
      config.body = JSON.stringify(data);
    }
    
    try {
      const response = await fetch(path, config);
      if (!response.ok) {
        let errorData: any = null;
        try {
          errorData = await response.json();
        } catch {
          try {
            errorData = await response.text();
          } catch {
         
          }
        }
        console.log("error:", errorData);

        throw new ArgoClientError(
            errorData?.message || errorData,
            response.status,
        );
      }

      if (expectJson) {
        try {
          const result = await response.json();
          return result;
        } catch {
          const textResult = await response.text();
          try {
            return JSON.parse(textResult) as T; 
          } catch {
            return textResult as unknown as T;
          }
        }
      } else {
        const textResult = await response.text();
        return textResult as unknown as T;
      }
    } catch (err: any) {
      if (err?.message?.includes('ERR_CERT_AUTHORITY_INVALID')) {
        throw new ArgoClientError(
          'SSL Certificate Error: Please accept the self-signed certificate by visiting https://localhost:2747 in your browser and accepting the security warning, then try again.',
          0,
          { originalError: err.message }
        );
      }
     
      throw err;
    }
  }

  public async checkHealth(namespace: string): Promise<{ isHealthy: boolean; error?: string }> {
    const path = `/api/v1/workflows/${namespace}?limit=1`;     
    try {
      const response = await this.request<WorkflowResponse>('GET', path, undefined, true);
      return { isHealthy: !!response };
    } catch (e: any) {
      return { isHealthy: false, error: e?.message || 'Unknown error' };
    }
  }
  

  public async submitWorkflow(
    workflowManifest: WorkflowManifest,
    namespace: string = this.namespace
  ): Promise<WorkflowResponse> {
    const path = `/api/v1/workflows/${namespace}`;     
    const requestBody = {
      workflow: workflowManifest,
      namespace: namespace
    };
    
    return this.request<WorkflowResponse>('POST', path, requestBody);
  }

  public async getWorkflow(
    name: string,
    namespace: string = this.namespace
  ): Promise<WorkflowResponse> {
    const path = `/api/v1/workflows/${namespace}/${name}`;
    return this.request<WorkflowResponse>('GET', path);
  }

  public async listWorkflows(
    namespace: string = this.namespace
  ): Promise<ApiResponse<WorkflowResponse>> {
    const path = `/api/v1/workflows/${namespace}`;
    return this.request<ApiResponse<WorkflowResponse>>('GET', path);
  }

   public async deleteWorkflow(
    name: string,
    namespace: string = this.namespace
  ): Promise<void> {
    const path = `/api/v1/workflows/${namespace}/${name}`;
    await this.request<void>('DELETE', path);
  }

  public async deleteAllWorkflows(
    namespace: string = this.namespace
  ): Promise<{ deleted: number; errors: string[] }> {
    const result = { deleted: 0, errors: [] as string[] };
    
    try {
      // First, list all workflows in the namespace
      const response = await this.listWorkflows(namespace);
      
      if (!response.items || response.items.length === 0) {
        return result;
      }
      
      // Delete each workflow one by one
      for (const workflow of response.items) {
        if (!workflow.metadata?.name) {
          result.errors.push(`Workflow missing name: ${JSON.stringify(workflow.metadata)}`);
          continue;
        }
        
        try {
          const name = workflow.metadata.name;
          await this.deleteWorkflow(name, namespace);
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
}

export default ArgoApiClient;
