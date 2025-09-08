/*
Copyright 2024 mylonics 
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as assert from "assert";
import { validateGitUrl } from "../utilities/utils";

suite("Git URL Validation Test Suite", () => {
    
    test("Validates HTTPS URLs correctly", () => {
        assert.strictEqual(validateGitUrl("https://github.com/user/repo.git"), undefined);
        assert.strictEqual(validateGitUrl("https://github.com/user/repo"), undefined);
        assert.strictEqual(validateGitUrl("http://gitlab.com/user/repo.git"), undefined);
    });

    test("Validates SSH URLs correctly", () => {
        // Traditional SSH format
        assert.strictEqual(validateGitUrl("git@github.com:user/repo.git"), undefined);
        assert.strictEqual(validateGitUrl("git@github.com:user/repo"), undefined);
        assert.strictEqual(validateGitUrl("user@host.com:path/to/repo.git"), undefined);
        
        // SSH with protocol
        assert.strictEqual(validateGitUrl("ssh://git@github.com/user/repo.git"), undefined);
    });

    test("Validates Git protocol URLs correctly", () => {
        assert.strictEqual(validateGitUrl("git://github.com/user/repo.git"), undefined);
    });

    test("Rejects invalid URLs correctly", () => {
        assert.strictEqual(validateGitUrl(""), "Please enter a valid Git URL");
        assert.strictEqual(validateGitUrl("   "), "Please enter a valid Git URL");
        assert.strictEqual(validateGitUrl("invalid-url"), "Please enter a valid Git URL (e.g., https://github.com/user/repo.git or git@github.com:user/repo.git)");
        assert.strictEqual(validateGitUrl("ftp://server.com/repo"), "Please enter a valid Git URL (supported protocols: http, https, ssh, git)");
    });

    test("Validates URLs from issue examples", () => {
        // The specific SSH URL mentioned in the issue
        assert.strictEqual(validateGitUrl("git@github.com:some-user/some-repo.git"), undefined);
        
        // The HTTPS version should also work
        assert.strictEqual(validateGitUrl("https://github.com/some-user/some-repo.git"), undefined);
    });
});