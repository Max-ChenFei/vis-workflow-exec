// TODO: add more specific types for Argo API responses
// This is a placeholder type for Argo API responses
export type ArgoRestApiResponse = any;

export interface ArgoStreamingResponse {
  type: string; // e.g., "ADDED", "MODIFIED", "DELETED"
  object: {
    metadata: {
      name: string;
    };
    status: {
      phase: string; // e.g., "Running", "Succeeded", "Failed"
      message?: string; // Optional message for the status
      nodes?: {
        [key: string]: {
          phase: string; // e.g., "Running", "Succeeded", "Failed"
          displayName?: string;
          type?: string; // e.g., "Pod", "Container"
          outputs?: {
            parameters?: Array<{
              name: string;
              value: string; // Output value
            }>;
          };
        };
      };
    };
  };
}
