// 知识卡加载。每张卡是 cards/ 下的一个 Markdown 文件，开头是简单的元信息：
//   id / title / status（draft = 草稿待审核，reviewed = 已审核）/ reviewer
// 只有 reviewed 的卡才应该在正式页面上展示；草稿会标明“待审核”。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CARDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../cards");

export interface KnowledgeCard {
  id: string;
  title: string;
  status: "draft" | "reviewed";
  reviewer: string | null;
  body: string;
  file: string;
}

export function parseCard(text: string, file: string): KnowledgeCard {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file} 缺少开头的 --- 元信息`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.title) throw new Error(`${file} 缺少 id 或 title`);
  return {
    id: meta.id,
    title: meta.title,
    status: meta.status === "reviewed" ? "reviewed" : "draft",
    reviewer: meta.reviewer || null,
    body: match[2].trim(),
    file,
  };
}

export function loadCard(id: string, dir: string = CARDS_DIR): KnowledgeCard | null {
  const file = path.join(dir, `${id}.md`);
  if (!fs.existsSync(file)) return null;
  return parseCard(fs.readFileSync(file, "utf8"), file);
}
