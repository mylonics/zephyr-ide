// SPDX-License-Identifier: Apache-2.0
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isPinnedRevision, tracksRemoteRevision } from "../../../utilities/west-revision";
import { repositoryAddresses } from "../../../utilities/repository-addresses";
import { live } from "lit/directives/live.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import "./west-repository-search";
import type { WestRepositorySearch } from "./west-repository-search";
import { moduleMatcher, moduleSearchBox } from "../../webview_shared/module-search";
import type { GitHubRepository } from "../../../setup_utilities/github-repositories";
import { changeSelection, westSelectionPane, westSelectionToolbar, type SelectionAction } from "../../webview_shared/west-selection";
import { panelText } from "../../webview_shared/panel-text";
import type { DependencyReference, DetectedDependency, WestCatalog, WestProject } from "../../../setup_utilities/west-projects";

export interface WestPickerData extends WestCatalog {
  scope: string;
  selected: string[];
  detected?: DetectedDependency[];
  unresolved?: DependencyReference[];
  error?: string;
  editError?: string;
  added?: string[];
}

@customElement("west-project-picker")
export class WestProjectPicker extends ZephyrLitElement {
  @property({ attribute: false }) catalog?: WestPickerData;
  @property({ type: Boolean }) checking = false;
  @property({ type: Boolean }) inactive = false;
  @state() private selected = new Set<string>();
  @state() private query = "";
  @state() private regex = false;
  @state() private discover = false;
  @state() private adding = false;
  @state() private lineCount = 0;
  private lastCheckoutKey?: string;
  @state() private editing?: WestProject;

  protected willUpdate(changes: PropertyValues) {
    const catalog = this.catalog;
    if (!changes.has("catalog") || !catalog) { return; }

    const knownNames = new Set(catalog.projects.map(project => project.name));
    this.selected = new Set(catalog.selected.filter(name => knownNames.has(name)));

    const previous = changes.get("catalog") as WestPickerData | undefined;
    if (previous?.scope !== catalog.scope) {
      this.query = "";
      this.regex = false;
      this.discover = false;
      this.adding = false;
    } else if (catalog.added) {
      this.adding = false;
    }

    this.refreshChangedCheckouts(catalog);
  }

  private refreshChangedCheckouts(catalog: WestPickerData) {
    const checkouts = catalog.projects
      .filter(tracksRemoteRevision)
      .map(project => [project.name, project.url, project.revision, project.checkout.head]);
    const checkoutKey = JSON.stringify([catalog.scope, ...checkouts]);
    if (this.lastCheckoutKey === checkoutKey) { return; }

    this.lastCheckoutKey = checkoutKey;
    this.send("refreshWestProjects");
  }

  private send(command: string, extras: Record<string, unknown> = {}) {
    this.vscodeApi.postMessage({ command, scope: this.catalog?.scope, ...extras });
  }

  private setSelection(rows: WestProject[], action: SelectionAction) {
    const names = changeSelection(this.selected, rows.map(project => project.name), action);
    this.selected = names;
    this.send("selectWestProjects", { names: [...names] });
  }

  private add(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    this.send("editWestProject", { url: fields.get("url"), revision: fields.get("revision"), destination: fields.get("destination"), previous: this.editing?.name });
  }

  private async showForm(repo?: GitHubRepository, existing?: WestProject) {
    this.adding = true;
    this.editing = existing;
    this.lineCount = repo || existing ? 1 : 0;
    await this.updateComplete;
    const form = this.querySelector("form");
    if (!form) { return; }
    const url = form.elements.namedItem("url") as HTMLTextAreaElement;
    url.value = existing?.url ?? (repo ? "https://github.com/" + repo.full_name : "");
    (form.elements.namedItem("revision") as HTMLInputElement).value = existing?.revision ?? repo?.default_branch ?? "";
    (form.elements.namedItem("destination") as HTMLInputElement).value = existing?.path ?? "";
    url.focus();
  }

  private origin(project: WestProject) {
    if (!project.extra) { return panelText("Workspace manifest"); }
    return /(?:^https?:\/\/|^ssh:\/\/git@|^git@)github\.com[/:]zephyrproject-rtos\//i.test(project.url)
      ? panelText("Official GitHub repositories") : panelText("Custom Git repositories");
  }

  private checkoutStatus(project: WestProject) {
    const status = (tone: string, icon: string, text: string) => html`
      <span class="wp-status" data-tone=${tone}>
        <span class="codicon codicon-${icon}" aria-hidden="true"></span>${text}
      </span>`;
    const { checkout, revision, remote } = project;
    if (checkout.state === "absent") { return status("muted", "cloud-download", panelText("Not downloaded")); }
    if (checkout.state === "invalid") { return status("error", "error", panelText("Checkout unavailable")); }
    if (isPinnedRevision(revision)) {
      return checkout.head === revision.toLowerCase()
        ? status("success", "check", panelText("At manifest revision"))
        : status("warning", "warning", panelText("Differs from manifest"));
    }
    if (!remote) { return status("downloaded", "clock", panelText("Downloaded · remote unchecked")); }
    if (remote.error) {
      return status("error", "error", remote.error === "refMissing" ? panelText("Downloaded · remote ref missing") : panelText("Downloaded · check failed"));
    }
    return checkout.head === remote.sha
      ? status("success", "check", panelText("Matches remote"))
      : status("info", "git-compare", panelText("Differs from remote"));
  }

  private dependencyReason(name: string) {
    const dependency = this.catalog?.detected?.find(item => item.name === name);
    if (dependency) {
      return html`<small title=${dependency.sources.join("\n")}>${panelText("Required by {0}", dependency.requiredBy.join(", "))}</small>`;
    }
    return this.selected.has(name) ? html`<small>${panelText("Manually selected")}</small>` : nothing;
  }

  private group(rows: WestProject[], label: string, pinned = false) {
    return html`<section class="wp-group" aria-label=${label}>
      ${pinned ? nothing : html`<h5>${label} <small>${rows.length}</small></h5>`}
      ${rows.length === 0 ? html`<p class="wp-empty">${pinned ? panelText("No modules selected") : panelText("No matches")}</p>` : nothing}
      ${rows.map(project => html`<div class="wp-row west-choice">
        <label title=${[project.url, project.revision].join("\n")}>
          <input type="checkbox" .checked=${live(this.selected.has(project.name))} ?disabled=${this.inactive}
            @change=${() => this.setSelection([project], "invert")}>
          <span><strong>${project.name}</strong><small>${project.path}${pinned ? " · " + this.origin(project) : ""}</small>${this.dependencyReason(project.name)}</span>
        </label>
        <span class="wp-checkout" title=${[project.checkout.head, project.remote?.sha].filter(Boolean).join(" → ")}>
          ${this.checkoutStatus(project)}${project.remote && project.checkout.state === "cloned" ? html`<small>${panelText("Checked {0}", new Date(project.remote.checkedAt).toLocaleString())}</small>` : nothing}
        </span>
        <span class="wp-revision" title=${project.revision}>
          <small>${panelText("Manifest revision")}</small><code>${/^[0-9a-f]{40,64}$/i.test(project.revision) ? project.revision.slice(0, 10) : project.revision}</code>
          ${project.revision === "HEAD" ? html`<small>${panelText("Not pinned to a commit")}</small>` : nothing}
        </span>
        ${!this.inactive ? html`
          <button type="button" aria-label=${project.checkout.state === "absent" ? panelText("Download {0}", project.name) : panelText("Update {0}", project.name)}
            @click=${() => this.send("updateWestProjects", { names: [project.name], preserveSelection: true })}>
            ${project.checkout.state === "absent" ? panelText("Download") : panelText("Update")}
          </button>
          <button type="button" aria-label=${panelText("Edit {0}", project.name)} @click=${() => this.showForm(undefined, project)}>${panelText("Edit")}</button>
          <button type="button" aria-label=${panelText("Remove {0}", project.name)}
          @click=${() => this.send("editWestProject", { remove: project.name })}>${panelText("Remove")}</button>` : nothing}
      </div>`)}
    </section>`;
  }

  private searchGitHub() {
    this.discover = true;
    this.querySelector<WestRepositorySearch>("west-repository-search")?.runSearch();
  }

  private renderRepositoryForm() {
    if (!this.adding || this.inactive) { return nothing; }

    const multipleRepositories = !this.editing && this.lineCount > 1;
    const canSubmit = this.editing ? this.lineCount === 1 : this.lineCount > 0;
    return html`<form @submit=${this.add}>
      <label>${this.editing ? panelText("Repository or commit URL") : panelText("Repository addresses")}
        <textarea required name="url" rows="3" spellcheck="false" aria-describedby="wp-url-help"
          placeholder="https://github.com/owner/hal_example"
          @input=${(e: Event) => { this.lineCount = repositoryAddresses((e.target as HTMLTextAreaElement).value).length; }}></textarea>
        <small id="wp-url-help">${this.editing ? panelText("Edit the address for this repository.") :
          panelText("One repository per line. Press Enter for a new line. Blank lines and surrounding spaces are ignored.")}</small>
      </label>
      ${multipleRepositories ? html`<p>${panelText("Each repository gets its own checkout path. Commit URLs pin the revision; other addresses use HEAD.")}</p>` : html`
        <label>${panelText("Branch, tag or commit")}<input name="revision" placeholder="HEAD"></label>
        <label>${panelText("Checkout path")}<input name="destination" placeholder="modules/lib/…"></label>`}
      <button type="submit" ?disabled=${!canSubmit}>
        ${this.editing ? panelText("Save") : panelText("Add repositories ({0})", this.lineCount)}</button>
      <button type="button" @click=${() => { this.adding = false; }}>${panelText("Cancel")}</button>
    </form>`;
  }

  private matchingProjects(projects: WestProject[], matches: (name: string) => boolean) {
    const query = this.query.trim().toLowerCase();
    const searchPath = !this.regex && query.includes("/");
    const searchRevision = !this.regex && /^[a-f0-9]{7,}$/i.test(query);
    return projects.filter(project => matches(project.name) ||
      (searchPath && [project.path, project.url].some(value => value.toLowerCase().includes(query))) ||
      (searchRevision && project.revision.toLowerCase().startsWith(query)));
  }

  private renderCatalog(data: WestPickerData | undefined, matches: (name: string) => boolean) {
    if (!data) {
      return html`<p role="status">${panelText("Loading west projects…")}</p>`;
    }
    if (data.error) {
      return html`<p role="alert">${data.error}</p>`;
    }
    const projects = data.projects;
    const rows = this.matchingProjects(projects, matches);
    const selected = projects.filter(project => this.selected.has(project.name));
    const available = rows.filter(project => !this.selected.has(project.name));
    const sources = [panelText("Workspace manifest"), panelText("Official GitHub repositories"), panelText("Custom Git repositories")];
    const locked = this.inactive || !rows.length;
    return html`
      ${data.unresolved?.map(ref => html`<p role="status" title=${ref.sources.join("\n")}><strong>${ref.name}</strong> · ${panelText("Required by {0}", ref.requiredBy.join(", "))} · ${panelText("No revision in the west manifest")}</p>`)}
      ${data.partial ? html`<p role="status">${panelText("Update the manifest provider and refresh to see its modules.")}</p>` : nothing}
      <div class="wp-tools">
        ${westSelectionToolbar(locked, action => this.setSelection(rows, action))}
        <span role="status">${panelText("{0} matched", rows.length)}</span>
      </div>
      ${this.discover && !this.inactive ? html`<west-repository-search .scope=${data.scope} .query=${this.query}
        .regex=${this.regex} .known=${projects.map(project => project.name.toLowerCase())}
        .choose=${(repo: GitHubRepository) => this.showForm(repo)}></west-repository-search>` : nothing}
      <div class="west-panes">
        ${westSelectionPane("wp-selected-title", panelText("Selected modules"), selected.length,
          this.group(selected, panelText("Selected modules"), true), this.inactive ? undefined : html`
            <vscode-button ?disabled=${!selected.length} @click=${() => this.send("updateWestProjects", { names: selected.map(project => project.name) })}>
              ${panelText("Download / update selected ({0})", selected.length)}
            </vscode-button>`)}
        ${westSelectionPane("wp-available-title", panelText("Available modules"), available.length, html`
          ${sources.map(label => {
            const group = available.filter(project => this.origin(project) === label);
            return group.length ? this.group(group, label) : nothing;
          })}
          ${available.length ? nothing : html`<p class="wp-empty">${panelText("No available modules")}</p>`}`)}
      </div>
      ${this.inactive ? nothing : html`
        <div class="wp-tools wp-actions">
          <button type="button" @click=${() => this.send("updateWestProjects", { names: [], all: true })}>${panelText("Run a full west update")}</button>
        </div>`}
    `;
  }

  render() {
    const data = this.catalog;
    const { matches, invalid } = moduleMatcher(this.query, this.regex);
    return html`
      <div class="wp-tools">
        ${moduleSearchBox(this.query, this.regex, value => { this.query = value; }, () => { this.regex = !this.regex; })}
        ${this.inactive ? nothing : html`
          <button type="button" ?disabled=${!data || !this.query.trim() || invalid}
            @click=${this.searchGitHub}>${panelText("Search GitHub sources")}</button>
          <button type="button" @click=${() => this.showForm()}>${panelText("Add Git repositories")}</button>`}
        <button type="button" ?disabled=${this.checking} @click=${() => this.send("refreshWestProjects", { force: true })}>${this.checking ? panelText("Checking updates…") : panelText("Check for updates")}</button>
        <button type="button" @click=${() => this.send("openWestYml")}>${panelText("Open in Editor")}</button>
      </div>
      ${this.renderRepositoryForm()}
      ${data?.editError ? html`<p role="alert">${data.editError}</p>` : nothing}
      ${invalid ? html`<p role="alert">${panelText("Invalid regular expression")}</p>` : nothing}
      ${this.renderCatalog(data, matches)}
    `;
  }
}
