import { Composition } from "remotion";
import { Gadai, totalFrames } from "./Gadai";

export const Root = () => (
  <Composition id="Gadai" component={Gadai} durationInFrames={totalFrames} fps={30} width={1920} height={1080} />
);
