import { FakeLayoutEngine } from "../src/testing.js";
import { layoutContract } from "./layoutContract.js";

layoutContract("FakeLayoutEngine", () => new FakeLayoutEngine());
