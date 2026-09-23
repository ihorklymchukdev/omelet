import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, isSessionLost, type SessionLoss } from "./client";

export function createQueryClient(onSessionLost: (reason: SessionLoss) => void): QueryClient {
  const onError = (error: unknown) => {
    if (isSessionLost(error)) onSessionLost(error.code);
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // A 4xx is the API's final word; only a missing or 5xx answer is worth retrying.
        retry: (failures, error) =>
          failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}
