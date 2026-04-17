import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  MarkdownView,
} from "obsidian";

interface DailyNoteEntry {
  title: string;
  content: string;
  date: Date;
}

interface DataviewPluginAPI {
  query: (
    query: string,
    sourcePath: string
  ) => Promise<
    | { successful: true; value: DataviewQueryResult }
    | { successful: false; error: string }
  >;
  evaluate: (expression: string) => unknown;
}

interface DataviewQueryResult {
  headers?: string[];
  values?: unknown[];
}

interface NoteRendererSettings {
  includeLinkedNotes: boolean;
  recursiveDepth: number;
  dailyNotesDaysToInclude: number;
  dailyNotesFolder: string;
}

const DEFAULT_SETTINGS: NoteRendererSettings = {
  includeLinkedNotes: true,
  recursiveDepth: 1,
  dailyNotesDaysToInclude: 7,
  dailyNotesFolder: "",
};

export default class NoteRendererPlugin extends Plugin {
  settings!: NoteRendererSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "render-and-copy-note",
      name: "Render & Copy Current Note",
      editorCallback: async () => {
        await this.renderCurrentNote();
      },
    });

    this.addCommand({
      id: "render-and-copy-note-backlinks",
      name: "Render & Copy Current Note + Backlinks",
      editorCallback: async () => {
        await this.renderCurrentNoteWithBacklinks();
      },
    });

    this.addCommand({
      id: "render-and-save-note",
      name: "Render and save to Desktop",
      editorCallback: async () => {
        await this.renderAndSaveNote();
      },
    });

    this.addCommand({
      id: "daily-notes-copy",
      name: "Copy Recent Daily Notes",
      callback: async () => {
        await this.generateDailyNotesPrompt();
      },
    });

    this.addSettingTab(new NoteRendererSettingTab(this.app, this));
  }

  async generateDailyNotesPrompt() {
    try {
      const dailyNotes = await this.getRecentDailyNotes();

      if (dailyNotes.length === 0) {
        new Notice("No daily notes found in the specified time range");
        return;
      }

      const prompt = this.formatDailyNotesPrompt(dailyNotes);

      await navigator.clipboard.writeText(prompt);

      const totalChars = prompt.length;
      new Notice(
        `✅ ${dailyNotes.length} daily notes copied! (${totalChars} chars)`
      );
    } catch (error) {
      new Notice(`❌ Failed to generate prompt: ${this.getErrorMessage(error)}`);
      console.error(error);
    }
  }

  async getRecentDailyNotes(): Promise<DailyNoteEntry[]> {
    const files = this.app.vault.getMarkdownFiles();
    const now = new Date();
    const cutoffDate = new Date(
      now.getTime() -
        this.settings.dailyNotesDaysToInclude * 24 * 60 * 60 * 1000
    );
    const dailyNotes: DailyNoteEntry[] = [];

    const searchFolder = this.settings.dailyNotesFolder;

    for (const file of files) {
      // Filter by folder if specified
      if (searchFolder && !file.path.startsWith(searchFolder)) {
        continue;
      }

      const basename = file.basename;
      const dateMatch = basename.match(/(\d{4})-(\d{2})-(\d{2})/);

      if (!dateMatch) continue;

      const fileDate = new Date(dateMatch[0]);

      if (fileDate >= cutoffDate && fileDate <= now) {
        const content = await this.app.vault.read(file);
        dailyNotes.push({ title: basename, content, date: fileDate });
      }
    }

    dailyNotes.sort((a, b) => b.date.getTime() - a.date.getTime());
    return dailyNotes;
  }

  formatDailyNotesPrompt(dailyNotes: DailyNoteEntry[]): string {
    let prompt = "# Daily Notes\n\n";

    for (const note of dailyNotes) {
      prompt += `## ${note.title}\n\n`;
      prompt += `${note.content}\n\n`;
    }

    return prompt;
  }

  async renderCurrentNote() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("No active note");
      return;
    }

    const file = activeView.file;
    if (!file) {
      new Notice("No file found");
      return;
    }

    try {
      const rendered = await this.renderNote(file);

      await navigator.clipboard.writeText(rendered);
      new Notice(`✅ Rendered note copied! (${rendered.length} chars)`);
    } catch (error) {
      new Notice(`❌ Failed to render: ${this.getErrorMessage(error)}`);
      console.error(error);
    }
  }

  async renderCurrentNoteWithBacklinks() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("No active note");
      return;
    }

    const file = activeView.file;
    if (!file) {
      new Notice("No file found");
      return;
    }

    try {
      const rendered = await this.renderNote(file);
      const backlinksSection = await this.buildBacklinksSection(file);
      const fullOutput = rendered.trimEnd() + "\n\n" + backlinksSection;

      await navigator.clipboard.writeText(fullOutput);
      new Notice(
        `✅ Rendered note + backlinks copied! (${fullOutput.length} chars)`
      );
    } catch (error) {
      new Notice(`❌ Failed to render: ${this.getErrorMessage(error)}`);
      console.error(error);
    }
  }

  getBacklinkFiles(targetFile: TFile): TFile[] {
    const { resolvedLinks } = this.app.metadataCache;
    const backlinkPaths: string[] = [];

    for (const [sourcePath, destMap] of Object.entries(resolvedLinks)) {
      const dest = destMap as Record<string, number>;
      if (dest[targetFile.path]) {
        backlinkPaths.push(sourcePath);
      }
    }

    return backlinkPaths
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md");
  }

  async findBacklinkLineSnippets(
    backlinkFile: TFile,
    targetFile: TFile
  ): Promise<string[]> {
    const content = await this.app.vault.read(backlinkFile);
    const lines = content.split("\n");
    const snippets: string[] = [];
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      wikiLinkRegex.lastIndex = 0;

      while ((match = wikiLinkRegex.exec(line)) !== null) {
        const linkpath = match[1].trim();
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
          linkpath,
          backlinkFile.path
        );
        if (resolved?.path === targetFile.path) {
          const trimmed = line.trim();
          if (trimmed && !snippets.includes(`${i + 1}: ${trimmed}`)) {
            snippets.push(`${i + 1}: ${trimmed}`);
          }
          break;
        }
      }
    }

    return snippets;
  }

  async buildBacklinksSection(targetFile: TFile): Promise<string> {
    const backlinkFiles = this.getBacklinkFiles(targetFile);

    if (backlinkFiles.length === 0) {
      return "# Backlinks\n\n[No backlinks found]";
    }

    let section = "# Backlinks\n\n";

    for (const backlinkFile of backlinkFiles) {
      const noteName = backlinkFile.basename;
      section += `## Backlink [[${noteName}]]\n\n`;

      const snippets = await this.findBacklinkLineSnippets(
        backlinkFile,
        targetFile
      );
      for (const snippet of snippets) {
        section += `- ${snippet}\n`;
      }
      section += "\n";
    }

    return section.trimEnd();
  }

  async renderAndSaveNote() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("No active note");
      return;
    }

    const file = activeView.file;
    if (!file) {
      new Notice("No file found");
      return;
    }

    try {
      const rendered = await this.renderNote(file);

      const electron = require("electron") as {
        remote?: { app: { getPath: (name: string) => string } };
      };
      const desktopPath = electron.remote?.app.getPath("desktop");
      if (!desktopPath) {
        throw new Error("Electron remote API is unavailable");
      }

      const outputFileName = `${file.basename}-rendered.md`;
      const path = require("path") as typeof import("path");
      const fs = require("fs") as typeof import("fs");
      const outputPath = path.join(desktopPath, outputFileName);

      fs.writeFileSync(outputPath, rendered, "utf-8");

      new Notice(
        `✅ Saved to Desktop: ${outputFileName} (${rendered.length} chars)`
      );
    } catch (error) {
      new Notice(`❌ Failed to save: ${this.getErrorMessage(error)}`);
      console.error(error);
    }
  }

  async renderNote(
    file: TFile,
    depth: number = 0,
    visited: Set<string> = new Set()
  ): Promise<string> {
    if (depth > this.settings.recursiveDepth || visited.has(file.path)) {
      return "";
    }
    visited.add(file.path);

    if (file.extension !== "md") {
      return "";
    }

    const content = await this.app.vault.read(file);
    const renderedContent = await this.renderContent(content, file);

    let output = `# ${file.basename}\n\n${renderedContent}\n\n`;

    if (
      this.settings.includeLinkedNotes &&
      depth < this.settings.recursiveDepth
    ) {
      const links = this.extractWikiLinks(renderedContent);

      if (links.length > 0) {
        output += `---\n\n# Linked Notes\n\n`;

        for (const link of links) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
            link,
            file.path
          );
          if (
            linkedFile &&
            linkedFile instanceof TFile &&
            linkedFile.extension === "md"
          ) {
            const linkedContent = await this.renderNote(
              linkedFile,
              depth + 1,
              visited
            );
            if (linkedContent) {
              output += linkedContent;
            }
          }
        }
      }
    }

    return output;
  }

  async renderContent(content: string, file: TFile): Promise<string> {
    let rendered = content;

    rendered = await this.renderDataviewQueries(rendered, file);
    rendered = this.removeFrontmatter(rendered);

    return rendered;
  }

  async renderDataviewQueries(content: string, file: TFile): Promise<string> {
    const dataviewAPI = (this.app as App & {
      plugins?: { plugins?: Record<string, { api?: DataviewPluginAPI }> };
    }).plugins?.plugins?.dataview?.api;

    if (!dataviewAPI) {
      return content.replace(
        /```dataview\n[\s\S]*?\n```/g,
        "[Dataview not available]"
      );
    }

    let rendered = content;
    const dataviewBlocks = content.matchAll(/```dataview\n([\s\S]*?)\n```/g);

    for (const match of dataviewBlocks) {
      const query = match[1];
      const fullMatch = match[0];

      try {
        const result = await this.executeDataviewQuery(
          query,
          file.path,
          dataviewAPI
        );
        rendered = rendered.replace(fullMatch, result);
      } catch (error) {
        console.error("Dataview query error:", error);
        rendered = rendered.replace(
          fullMatch,
          `[Dataview error: ${this.getErrorMessage(error)}]`
        );
      }
    }

    rendered = rendered.replace(/`=\s*(.+?)`/g, (match, query) => {
      try {
        const result = dataviewAPI.evaluate(query);
        return result?.toString() || match;
      } catch (error) {
        return match;
      }
    });

    return rendered;
  }

  async executeDataviewQuery(
    query: string,
    sourcePath: string,
    dataviewAPI: DataviewPluginAPI
  ): Promise<string> {
    const trimmedQuery = query.trim();

    let queryType = "list";
    if (trimmedQuery.toUpperCase().startsWith("TABLE")) {
      queryType = "table";
    } else if (trimmedQuery.toUpperCase().startsWith("TASK")) {
      queryType = "task";
    } else if (trimmedQuery.toUpperCase().startsWith("CALENDAR")) {
      queryType = "calendar";
    }

    try {
      const result = await dataviewAPI.query(trimmedQuery, sourcePath);

      if (!result.successful) {
        return `[Query failed: ${result.error}]`;
      }

      return this.formatDataviewResult(result.value, queryType);
    } catch (error) {
      return `[Query error: ${this.getErrorMessage(error)}]`;
    }
  }

  formatDataviewResult(result: DataviewQueryResult, queryType: string): string {
    if (!result || !result.values || result.values.length === 0) {
      return "[No results]";
    }

    if (queryType === "table") {
      return this.formatTableResult(result);
    } else if (queryType === "task") {
      return this.formatTaskResult(result);
    } else {
      return this.formatListResult(result);
    }
  }

  formatTableResult(result: DataviewQueryResult): string {
    const headers = result.headers || [];
    const values = result.values || [];

    if (values.length === 0) return "[No results]";

    let markdown = "| " + headers.join(" | ") + " |\n";
    markdown += "| " + headers.map(() => "---").join(" | ") + " |\n";

    for (const row of values) {
      if (!Array.isArray(row)) {
        continue;
      }
      const cells = row.map((cell) => this.formatValue(cell));
      markdown += "| " + cells.join(" | ") + " |\n";
    }

    return markdown;
  }

  formatListResult(result: DataviewQueryResult): string {
    const values = result.values || [];
    if (values.length === 0) return "[No results]";

    return values
      .map((item) => {
        const link = this.getLinkPath(item);
        if (link) {
          return `- [[${link}]]`;
        }
        return `- ${this.formatValue(item)}`;
      })
      .join("\n");
  }

  formatTaskResult(result: DataviewQueryResult): string {
    const values = result.values || [];
    if (values.length === 0) return "[No results]";

    return values
      .map((task) => {
        const checkbox = this.getTaskCompleted(task) ? "[x]" : "[ ]";
        const text = this.getTaskText(task);
        return `- ${checkbox} ${text}`;
      })
      .join("\n");
  }

  formatValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    const linkPath = this.getLinkPath(value);
    if (linkPath) return `[[${linkPath}]]`;
    if (Array.isArray(value))
      return value.map((v) => this.formatValue(v)).join(", ");
    if (typeof value === "object" && value.toString) return value.toString();
    return String(value);
  }

  getLinkPath(value: unknown): string | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const maybePath = value as { path?: unknown; file?: { path?: unknown } };
    if (typeof maybePath.path === "string") {
      return maybePath.path;
    }
    if (typeof maybePath.file?.path === "string") {
      return maybePath.file.path;
    }

    return undefined;
  }

  getTaskCompleted(value: unknown): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }
    return Boolean((value as { completed?: unknown }).completed);
  }

  getTaskText(value: unknown): string {
    if (!value || typeof value !== "object") {
      return "";
    }
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  extractWikiLinks(content: string): string[] {
    const links: string[] = [];
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const link = match[1].trim();
      if (!links.includes(link)) {
        links.push(link);
      }
    }

    return links;
  }

  removeFrontmatter(content: string): string {
    if (content.startsWith("---")) {
      const endIndex = content.indexOf("---", 3);
      if (endIndex !== -1) {
        return content.substring(endIndex + 3).trim();
      }
    }
    return content;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class NoteRendererSettingTab extends PluginSettingTab {
  plugin: NoteRendererPlugin;

  constructor(app: App, plugin: NoteRendererPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Note Renderer Settings" });

    new Setting(containerEl)
      .setName("Include linked notes")
      .setDesc("Append contents of all wikilinked notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeLinkedNotes)
          .onChange(async (value) => {
            this.plugin.settings.includeLinkedNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Recursive depth")
      .setDesc(
        "How many levels deep to follow links (0 = disabled, 1 = direct links only)"
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 3, 1)
          .setValue(this.plugin.settings.recursiveDepth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.recursiveDepth = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h2", { text: "Daily Notes Settings" });

    new Setting(containerEl)
      .setName("Number of days to include")
      .setDesc("How many recent days of daily notes to include")
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.dailyNotesDaysToInclude)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesDaysToInclude = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc(
        "Folder path containing daily notes (leave empty to search entire vault)"
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g., Daily Notes")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
