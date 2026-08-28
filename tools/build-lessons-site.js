#!/usr/bin/env node
// Builds a single-page HTML study site from lessons/*.md.
// Usage: node tools/build-lessons-site.js
// Output: tools/dist/lessons-site.html (open directly in a browser,
// or paste into Claude as an Artifact).

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const LESSONS_DIR = path.join(REPO_ROOT, 'lessons');
const TEMPLATE_PATH = path.join(__dirname, 'lessons-site-template.html');
const OUT_DIR = path.join(__dirname, 'dist');
const OUT_PATH = path.join(OUT_DIR, 'lessons-site.html');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SCALA_KEYWORDS = new Set([
  'val', 'var', 'def', 'class', 'object', 'trait', 'extends', 'with',
  'override', 'implicit', 'implicitly', 'case', 'match', 'if', 'else',
  'for', 'while', 'do', 'yield', 'new', 'this', 'super', 'import',
  'package', 'private', 'protected', 'sealed', 'abstract', 'final',
  'lazy', 'throw', 'try', 'catch', 'finally', 'return', 'type',
  'forSome', 'macro', 'null', 'true', 'false'
]);

const SCALA_TOKEN_RE = new RegExp(
  '(//[^\\n]*)' +                                    // 1: line comment
  '|(/\\*[\\s\\S]*?\\*/)' +                           // 2: block comment
  '|((?:s|f|raw)?"""[\\s\\S]*?"""|(?:s|f|raw)?"(?:\\\\.|[^"\\\\])*")' + // 3: string
  '|(\'(?:\\\\.|[^\'\\\\])\'|\'[A-Za-z_]\\w*)' +      // 4: char / symbol literal
  '|(@\\w+)' +                                        // 5: annotation
  '|\\b([A-Za-z_]\\w*)\\b' +                          // 6: identifier
  '|\\b(\\d+\\.?\\d*[fFdDlL]?)\\b',                   // 7: number
  'g'
);

function highlightScala(code) {
  let result = '';
  let last = 0;
  let m;
  SCALA_TOKEN_RE.lastIndex = 0;
  while ((m = SCALA_TOKEN_RE.exec(code))) {
    if (m.index > last) result += escapeHtml(code.slice(last, m.index));
    if (m[1] || m[2]) {
      result += '<span class="tok-com">' + escapeHtml(m[1] || m[2]) + '</span>';
    } else if (m[3]) {
      result += '<span class="tok-str">' + escapeHtml(m[3]) + '</span>';
    } else if (m[4]) {
      result += '<span class="tok-str">' + escapeHtml(m[4]) + '</span>';
    } else if (m[5]) {
      result += '<span class="tok-ann">' + escapeHtml(m[5]) + '</span>';
    } else if (m[6]) {
      const word = m[6];
      if (SCALA_KEYWORDS.has(word)) {
        result += '<span class="tok-kw">' + word + '</span>';
      } else if (/^[A-Z]/.test(word)) {
        result += '<span class="tok-type">' + word + '</span>';
      } else {
        result += word;
      }
    } else if (m[7]) {
      result += '<span class="tok-num">' + m[7] + '</span>';
    }
    last = SCALA_TOKEN_RE.lastIndex;
  }
  result += escapeHtml(code.slice(last));
  return result;
}

function inline(text) {
  // escape first, then apply inline rules
  let s = escapeHtml(text);
  // inline code (protect from other rules); stash already-escaped content
  const codeStash = [];
  s = s.replace(/`([^`]+)`/g, function (m, code) {
    codeStash.push(code);
    return 'zzCODEMARKzz' + (codeStash.length - 1) + 'zzCODEMARKzz';
  });
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  // restore code (content was already escaped above; do not escape twice)
  s = s.replace(/zzCODEMARKzz(\d+)zzCODEMARKzz/g, function (m, i) {
    return '<code>' + codeStash[i] + '</code>';
  });
  return s;
}

function stripPipes(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^\|?(.*?)\|?$/);
  return m ? m[1] : trimmed;
}

function stripBlockquoteMarker(line) {
  const m = line.match(/^\s*>\s?(.*)$/);
  return m ? m[1] : line;
}

function parseTable(lines, i) {
  // lines[i] is header row, lines[i+1] is separator
  const header = stripPipes(lines[i]).split('|').map(function (c) { return c.trim(); });
  let j = i + 2;
  const rows = [];
  while (j < lines.length && lines[j].trim().startsWith('|')) {
    rows.push(stripPipes(lines[j]).split('|').map(function (c) { return c.trim(); }));
    j++;
  }
  let html = '<div class="table-wrap"><table><thead><tr>';
  header.forEach(function (h) { html += '<th>' + inline(h) + '</th>'; });
  html += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    html += '<tr>';
    r.forEach(function (c) { html += '<td>' + inline(c) + '</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return { html: html, next: j };
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let out = [];
  let i = 0;
  let listStack = []; // {type, indent}

  function closeLists(toIndent) {
    while (listStack.length && (toIndent === -1 || listStack[listStack.length - 1].indent >= toIndent)) {
      const l = listStack.pop();
      out.push(l.type === 'ol' ? '</ol>' : '</ul>');
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      closeLists(-1);
      const lang = fence[1] ? fence[1] : 'scala';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const codeText = codeLines.join('\n');
      const rendered = lang === 'scala' ? highlightScala(codeText) : escapeHtml(codeText);
      out.push('<pre class="lang-' + lang + '"><code>' + rendered + '</code></pre>');
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) {
      closeLists(-1);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*---+\s*$/.test(line) && out.length && !/^#/.test(lines[i - 1] || '.')) {
      closeLists(-1);
      out.push('<hr>');
      i++;
      continue;
    }

    // table
    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      closeLists(-1);
      const parsed = parseTable(lines, i);
      out.push(parsed.html);
      i = parsed.next;
      continue;
    }

    // headers
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists(-1);
      const level = h[1].length;
      out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      closeLists(-1);
      const bq = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        bq.push(stripBlockquoteMarker(lines[i]));
        i++;
      }
      out.push('<blockquote><p>' + inline(bq.join(' ')) + '</p></blockquote>');
      continue;
    }

    // list item (ordered or unordered), track indent for nesting
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const isOrdered = /\d+\./.test(li[2]);
      const type = isOrdered ? 'ol' : 'ul';

      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        out.push(listStack.pop().type === 'ol' ? '</ol>' : '</ul>');
      }
      if (!listStack.length || listStack[listStack.length - 1].indent < indent) {
        out.push(type === 'ol' ? '<ol>' : '<ul>');
        listStack.push({ type: type, indent: indent });
      } else if (listStack[listStack.length - 1].type !== type) {
        out.push(listStack.pop().type === 'ol' ? '</ol>' : '</ul>');
        out.push(type === 'ol' ? '<ol>' : '<ul>');
        listStack.push({ type: type, indent: indent });
      }
      out.push('<li>' + inline(li[3]) + '</li>');
      i++;
      continue;
    }

    // paragraph (collect contiguous non-blank, non-special lines)
    closeLists(-1);
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^```/.test(lines[i]) && !/^\s*[-*]\s|^\s*\d+\.\s/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }
  closeLists(-1);
  return out.join('\n');
}

// group lessons by numeric prefix range into curriculum sections
function groupFor(file) {
  if (file === '00-roadmap.md') return 'Roadmap';
  const n = file.slice(0, 2);
  if (n === '00') return 'Prelude';
  const num = parseInt(n, 10);
  if (num >= 1 && num <= 7) return 'Functional Foundations';
  if (num >= 8 && num <= 11) return 'Concurrency';
  if (num >= 12 && num <= 21) return 'Implicits & Type Classes';
  if (num >= 22 && num <= 30) return 'The Type System';
  return 'Other';
}

function titleFromFile(f) {
  return f.replace(/^\d+-/, '').replace(/\.md$/, '').split('-')
    .map(function (w) { return w[0].toUpperCase() + w.slice(1); })
    .join(' ');
}

const GROUP_ORDER = ['Roadmap', 'Prelude', 'Functional Foundations', 'Concurrency', 'Implicits & Type Classes', 'The Type System', 'Other'];

const REPO_BLOB_BASE = 'https://github.com/npwiebe/scala-2-advanced/blob/master/';
const REPO_SOURCES_URL = 'https://github.com/npwiebe/scala-2-advanced/tree/master/src/lectures';

// maps lesson id -> source .scala file, relative to repo root (from lessons/00-roadmap.md)
const SOURCE_MAP = {
  '01-dark-sugars': 'src/lectures/part1as/DarkSugars.scala',
  '02-advanced-pattern-matching': 'src/lectures/part1as/AdvancedPatternMatching.scala',
  '03-partial-functions': 'src/lectures/part2afp/PartialFunctions.scala',
  '04-currying-and-paf': 'src/lectures/part2afp/CurriesPAF.scala',
  '05-lazy-evaluation': 'src/lectures/part2afp/LazyEvaluation.scala',
  '06-monads': 'src/lectures/part2afp/Monads.scala',
  '07-exercise-streams': 'src/exercises/StreamsPlayground.scala',
  '08-concurrency-intro': 'src/lectures/part3concurrency/Intro.scala',
  '09-thread-communication': 'src/lectures/part3concurrency/ThreadCommunication.scala',
  '10-futures-and-promises': 'src/lectures/part3concurrency/FuturesPromises.scala',
  '11-parallel-utils': 'src/lectures/part3concurrency/ParallelUtils.scala',
  '12-implicits-intro': 'src/lectures/part4implicits/ImplicitsIntro.scala',
  '13-organizing-implicits': 'src/lectures/part4implicits/OrganizingImplicits.scala',
  '14-pimp-my-library': 'src/lectures/part4implicits/PimpMyLibrary.scala',
  '15-type-classes': 'src/lectures/part4implicits/TypeClasses.scala',
  '16-exercise-equality-type-class': 'src/exercises/EqualityPlayground.scala',
  '17-type-class-template': 'src/lectures/part4implicits/MyTypeClassTemplate.scala',
  '18-scala-java-conversions': 'src/lectures/part4implicits/ScalaJavaConversions.scala',
  '19-magnet-pattern': 'src/lectures/part4implicits/MagnetPattern.scala',
  '20-json-serialization': 'src/lectures/part4implicits/JSONSerialization.scala',
  '21-exercise-myset': 'src/exercises/MySet.scala',
  '22-inheritance-edge-cases': 'src/lectures/part5ts/RockingInheritance.scala',
  '23-self-types': 'src/lectures/part5ts/SelfTypes.scala',
  '24-path-dependent-types': 'src/lectures/part5ts/PathDependentTypes.scala',
  '25-type-members': 'src/lectures/part5ts/TypeMembers.scala',
  '26-variance': 'src/lectures/part5ts/Variance.scala',
  '27-f-bounded-polymorphism': 'src/lectures/part5ts/FBoundedPolymorphism.scala',
  '28-structural-types': 'src/lectures/part5ts/StructuralTypes.scala',
  '29-higher-kinded-types': 'src/lectures/part5ts/HigherKindedTypes.scala',
  '30-reflection': 'src/lectures/part5ts/Reflection.scala'
};

function main() {
  const files = fs.readdirSync(LESSONS_DIR).filter(function (f) { return f.endsWith('.md'); }).sort();
  const lessons = files.map(function (f) {
    const raw = fs.readFileSync(path.join(LESSONS_DIR, f), 'utf8');
    return {
      file: f,
      id: f.replace(/\.md$/, ''),
      shortTitle: titleFromFile(f),
      group: groupFor(f),
      html: mdToHtml(raw)
    };
  });

  const grouped = {};
  lessons.forEach(function (l) {
    (grouped[l.group] = grouped[l.group] || []).push(l);
  });

  let navHtml = '';
  let articlesHtml = '';
  GROUP_ORDER.forEach(function (g) {
    if (!grouped[g]) return;
    navHtml += '<div class="nav-group"><h2>' + g + '</h2><ul>';
    grouped[g].forEach(function (l) {
      navHtml += '<li><a href="#' + l.id + '" data-target="' + l.id + '">' + l.shortTitle + '</a></li>';
      let articleHtml = l.html;
      const src = SOURCE_MAP[l.id];
      if (src) {
        const link = '<p class="source-link">Source: <a href="' + REPO_BLOB_BASE + src + '" target="_blank" rel="noopener">' + src + '</a></p>';
        articleHtml = articleHtml.replace('</h1>', '</h1>' + link);
      }
      articlesHtml += '<article id="' + l.id + '" class="lesson">' + articleHtml + '</article>';
    });
    navHtml += '</ul></div>';
  });

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const out = template
    .replace('__NAV__', navHtml)
    .replace('__ARTICLES__', articlesHtml)
    .replace('__SOURCES_URL__', REPO_SOURCES_URL);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, out);
  console.log('Built ' + lessons.length + ' lessons -> ' + OUT_PATH + ' (' + out.length + ' bytes)');
}

main();
