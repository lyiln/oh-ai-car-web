export {};

declare global {
  interface Window {
    AMap?: {
      Map: new (node: HTMLElement, options: object) => {
        destroy: () => void;
        setFitView: (overlays?: unknown[]) => void;
        setCenter: (center: number[]) => void;
        setZoom: (zoom: number) => void;
        add: (overlays: unknown[]) => void;
        clearMap: () => void;
      };
      Marker: new (options: object) => unknown;
      Polyline: new (options: object) => unknown;
      convertFrom: (
        points: number[][],
        type: string,
        callback: (status: string, result: { locations: Array<{ lng: number; lat: number }> }) => void,
      ) => void;
    };
    _AMapSecurityConfig?: { serviceHost: string };
  }
}
