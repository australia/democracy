declare module "shapefile" {
  export interface ShapefileSource<P = Record<string, unknown>> {
    read(): Promise<
      | { done: true; value: undefined }
      | {
          done: false;
          value: {
            type: "Feature";
            geometry:
              | { type: "Polygon"; coordinates: number[][][] }
              | { type: "MultiPolygon"; coordinates: number[][][][] }
              | { type: "Point"; coordinates: number[] }
              | { type: "LineString"; coordinates: number[][] };
            properties: P;
          };
        }
    >;
  }
  export function open(
    shp: string,
    dbf?: string | null,
  ): Promise<ShapefileSource>;
}
