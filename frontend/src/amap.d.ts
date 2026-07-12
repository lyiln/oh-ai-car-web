export {};

declare global {
  interface AMapOverlay {
    on?: (event: string, handler: (event?: { target?: AMapPolygon }) => void) => void;
    setMap?: (map: AMapMapInstance | null) => void;
    getExtData?: () => unknown;
    setExtData?: (data: unknown) => void;
  }

  interface AMapPolygon extends AMapOverlay {
    getPath: () => Array<{ lng: number; lat: number } | number[]>;
    setOptions?: (options: object) => void;
  }

  interface AMapMapInstance {
    destroy: () => void;
    setFitView: (overlays?: unknown[]) => void;
    setCenter: (center: number[]) => void;
    setZoom: (zoom: number) => void;
    add: (overlays: unknown[] | unknown) => void;
    remove?: (overlays: unknown[] | unknown) => void;
    clearMap: () => void;
  }

  interface AMapMouseTool {
    polygon: (options?: object) => void;
    close: (clear?: boolean) => void;
    on: (event: string, handler: (event: { obj: AMapPolygon }) => void) => void;
  }

  interface AMapPolygonEditor {
    open: () => void;
    close: () => void;
    setTarget: (polygon?: AMapPolygon) => void;
    getTarget: () => AMapPolygon | undefined;
  }

  interface AMapGeolocationResult {
    position: { lng: number; lat: number };
    message?: string;
  }

  interface AMapGeolocation {
    getCurrentPosition: (
      callback: (status: string, result: AMapGeolocationResult) => void,
    ) => void;
  }

  interface Window {
    AMap?: {
      Map: new (node: HTMLElement, options: object) => AMapMapInstance;
      Marker: new (options: object) => AMapOverlay;
      Polyline: new (options: object) => AMapOverlay;
      Polygon?: new (options: object) => AMapPolygon;
      Text?: new (options: object) => AMapOverlay;
      MouseTool?: new (map: AMapMapInstance) => AMapMouseTool;
      PolygonEditor?: new (map: AMapMapInstance, polygon?: AMapPolygon) => AMapPolygonEditor;
      Geolocation?: new (options?: object) => AMapGeolocation;
      plugin?: (names: string | string[], callback: () => void) => void;
      convertFrom: (
        points: number[][],
        type: string,
        callback: (status: string, result: { locations: Array<{ lng: number; lat: number }> }) => void,
      ) => void;
    };
    _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string };
  }
}
