// Same check for CommonJS consumers (resolves the "require" condition, index.d.cts).
import { DefaultExperiment, MismatchError } from "@mhvelplund/scientist";

export const experiment: DefaultExperiment<number> = new DefaultExperiment<number>("cjs");
export const isError: boolean = MismatchError.prototype instanceof Error;
