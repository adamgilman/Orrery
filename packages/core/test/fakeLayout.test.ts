import { FakeLayoutEngine } from "../src/index.js";
import { layoutContract } from "./layoutContract.js";

layoutContract("FakeLayoutEngine", () => new FakeLayoutEngine());
