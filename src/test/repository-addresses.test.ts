// SPDX-License-Identifier: Apache-2.0
import * as assert from "assert";
import { repositoryAddresses } from "../utilities/repository-addresses";

suite("Pasted repository addresses", () => {
  test("trims each address and retains input line numbers across blank lines", () => {
    assert.deepStrictEqual(repositoryAddresses(" \tfirst  \r\n \r\n\tsecond\t\n\u3000third \r"), [
      { url: "first", number: 1 }, { url: "second", number: 3 }, { url: "third", number: 4 },
    ]);
    assert.deepStrictEqual(repositoryAddresses("  \n\t\r\n"), []);
  });
});
