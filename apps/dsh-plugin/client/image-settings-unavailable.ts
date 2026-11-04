/** DSH supplies text/diagram generation through its model service. Optional
 * raster-image providers have no settings in this host and make no requests. */
const unavailable = {
  data: {config: {provider: 'none', model: '', enabled: false, maxIllustrations: 0}, providers: [] as {id: string; configured: boolean}[]},
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
};

export function useImageSettings(_enabled = true) { return unavailable; }
