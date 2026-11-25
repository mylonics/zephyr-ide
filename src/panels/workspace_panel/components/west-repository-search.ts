// SPDX-License-Identifier: Apache-2.0
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import { panelText } from "../../webview_shared/panel-text";
import { moduleMatcher } from "../../webview_shared/module-search";
import type { GitHubRepository } from "../../../setup_utilities/github-repositories";

@customElement("west-repository-search")
export class WestRepositorySearch extends ZephyrLitElement {
  @property() query = "";
  @property({ type: Boolean }) regex = false;
  @property() scope = "";
  @property({ attribute: false }) known: string[] = [];
  @property({ attribute: false }) choose!: (repo: GitHubRepository) => void;
  @state() private owner = "zephyrproject-rtos";
  @state() private items: GitHubRepository[] = [];
  @state() private searchMode: "owner" | "global" = "owner";
  @state() private busy = false;
  @state() private error = "";
  private source = "";
  private requestId = 0;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.receive);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.receive);
  }

  private receive = ({ data }: MessageEvent) => {
    if (data.command !== "githubRepositoryResults" || data.scope !== this.scope || data.id !== this.requestId) { return; }
    this.items = data.items ?? [];
    this.error = data.error ?? "";
    this.busy = false;
  };

  private get repositoryQuery() {
    if (!this.regex) {
      const link = /^(?:https:\/\/github\.com\/)?([a-z\d-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(this.query.trim());
      if (link) { return { owner: link[1], name: link[2] }; }
    }
    return { owner: this.owner, name: this.query.trim() };
  }
  private get ownerSource() {
    return this.scope + ":" + this.repositoryQuery.owner;
  }

  protected updated(changes: PropertyValues) {
    if (!this.query.trim()) { return; }

    const queryChanged = changes.has("query") || changes.has("regex");
    if (this.searchMode === "global" && !queryChanged) { return; }

    const sourceChanged = changes.has("scope") || changes.has("owner") || this.source !== this.ownerSource;
    if (sourceChanged) {
      this.runSearch();
    }
  }

  public runSearch() {
    this.search("owner");
  }

  private search(mode: "owner" | "global") {
    const { owner, name } = this.repositoryQuery;
    this.searchMode = mode;
    this.source = mode === "owner" ? this.ownerSource : "";
    this.items = [];
    this.error = "";
    this.busy = true;
    this.vscodeApi.postMessage({
      command: "searchGitHubRepositories",
      id: ++this.requestId,
      scope: this.scope,
      owner,
      query: mode === "global" ? name : undefined,
    });
  }

  private renderResults(matches: (name: string) => boolean) {
    if (this.busy) {
      return html`<p role="status">${panelText("Searching GitHub…")}</p>`;
    }
    if (this.error) {
      return html`<p role="alert">${this.error}</p>`;
    }

    const repositories = this.items.filter(repo => {
      const name = repo.full_name.split("/")[1];
      return matches(name) && !this.known.includes(name.toLowerCase());
    }).sort((a, b) => a.full_name.localeCompare(b.full_name, "en"));

    if (!repositories.length) {
      return html`<p class="wp-empty">${panelText("No additional repositories matched.")}</p>`;
    }
    return html`<div class="wp-remote-results">
      ${repositories.map(repo => html`<div class="wp-row">
        <span>${repo.full_name}</span>
        <button type="button" aria-label=${panelText("Add {0}", repo.full_name)} @click=${() => this.choose(repo)}>
          ${panelText("Add repository")}…
        </button>
      </div>`)}
    </div>`;
  }

  render() {
    if (!this.query.trim()) { return nothing; }
    const { matches, invalid } = moduleMatcher(this.repositoryQuery.name, this.regex);
    if (invalid) { return nothing; }
    return html`<section aria-label="GitHub" class="wp-discovery">
      <div class="wp-tools"><strong>GitHub</strong>
        <label>${panelText("Owner")} <input aria-label=${panelText("GitHub owner")} .value=${this.repositoryQuery.owner}
          @change=${(e: Event) => { this.owner = (e.target as HTMLInputElement).value.trim(); }}></label>
        <button @click=${() => this.runSearch()}>${panelText("Search owner")}</button>
        <button ?disabled=${this.regex} @click=${() => this.search("global")}>${panelText("Search GitHub by name")}</button>
      </div>
      ${this.renderResults(matches)}
    </section>`;
  }
}
