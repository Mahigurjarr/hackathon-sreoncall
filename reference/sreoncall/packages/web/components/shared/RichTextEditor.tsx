'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './RichTextEditor.module.css';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Quote,
  Code,
  FileCode,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListChecks,
  Table as TableIcon,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
} from 'lucide-react';

// document.execCommand emits legacy/inconsistent markup (<b>, <i>, style-based
// spans) depending on browser; normalize to the semantic tags the comment
// renderer's sanitizer allowlist expects before the HTML leaves the editor.
const BLOCK_TAGS = /^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE)$/;

const INLINE_STYLE_TAGS: Array<{ test: RegExp; tag: string }> = [
  { test: /text-decoration(-line)?\s*:\s*underline/i, tag: 'u' },
  { test: /text-decoration(-line)?\s*:\s*line-through/i, tag: 's' },
  { test: /font-weight\s*:\s*(bold|[6-9]00)/i, tag: 'strong' },
  { test: /font-style\s*:\s*italic/i, tag: 'em' },
];

function normalizeFormatting(root: HTMLElement) {
  for (const b of Array.from(root.querySelectorAll('b'))) {
    const strong = document.createElement('strong');
    strong.append(...Array.from(b.childNodes));
    b.replaceWith(strong);
  }
  for (const i of Array.from(root.querySelectorAll('i'))) {
    const em = document.createElement('em');
    em.append(...Array.from(i.childNodes));
    i.replaceWith(em);
  }
  for (const span of Array.from(root.querySelectorAll('span'))) {
    const style = span.getAttribute('style') || '';
    const matchedTags = INLINE_STYLE_TAGS.filter(({ test }) => test.test(style)).map(({ tag }) => tag);
    if (!matchedTags.length) {
      span.replaceWith(...Array.from(span.childNodes));
      continue;
    }
    let wrapped: DocumentFragment | HTMLElement = document.createDocumentFragment();
    wrapped.append(...Array.from(span.childNodes));
    for (const tag of matchedTags) {
      const el = document.createElement(tag);
      el.append(wrapped);
      wrapped = el;
    }
    span.replaceWith(wrapped);
  }
  // Chrome/Firefox wrap plain lines in <div> inside contentEditable; the
  // sanitizer allowlist only knows <p>.
  for (const div of Array.from(root.querySelectorAll('div'))) {
    const p = document.createElement('p');
    p.append(...Array.from(div.childNodes));
    div.replaceWith(p);
  }
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onSubmit?: () => void;
  onImagePaste?: (file: File) => Promise<string | null>;
  placeholder?: string;
}

const HEADING_OPTIONS = [
  { tag: 'P', label: 'Normal text', icon: Pilcrow },
  { tag: 'H1', label: 'Heading 1', icon: Heading1 },
  { tag: 'H2', label: 'Heading 2', icon: Heading2 },
  { tag: 'H3', label: 'Heading 3', icon: Heading3 },
];

export function RichTextEditor({
  value,
  onChange,
  onSubmit,
  onImagePaste,
  placeholder = 'Write something...',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef(value);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [activeBlock, setActiveBlock] = useState('P');

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastHtmlRef.current) return;
    editor.innerHTML = value;
    lastHtmlRef.current = value;
  }, [value]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    // Normalize a detached clone rather than the live node so the caret/selection
    // in the actual contentEditable element is never disturbed while typing.
    const clone = editor.cloneNode(true) as HTMLElement;
    normalizeFormatting(clone);
    const html = clone.innerHTML;
    lastHtmlRef.current = html;
    onChange(html);
  }

  function runCommand(command: string, valueArg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, valueArg);
    refreshActiveBlock();
    emitChange();
  }

  function refreshActiveBlock() {
    const block = document.queryCommandValue('formatBlock') || 'P';
    setActiveBlock(String(block).replace(/[<>]/g, '').toUpperCase());
  }

  // Used for block-level inserts (table/task list/code block/pasted image).
  // execCommand('insertHTML') is unreliable here: if the caret sits in an
  // empty <p> (e.g. one just created by pressing Enter), Chrome nests the
  // incoming block content invalidly *inside* that <p> instead of splitting
  // around it, corrupting the structure. Building the fragment ourselves and
  // inserting it with the Range API sidesteps that browser behavior entirely.
  function insertHtml(html: string) {
    const editor = editorRef.current;
    editor?.focus();
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();

    const template = document.createElement('template');
    template.innerHTML = html;
    const fragment = template.content;

    let blockEl: HTMLElement | null =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement);
    while (blockEl && blockEl !== editor && !BLOCK_TAGS.test(blockEl.tagName)) {
      blockEl = blockEl.parentElement;
    }
    const isEmptyBlock =
      blockEl && blockEl !== editor && blockEl.parentElement === editor &&
      (blockEl.innerHTML === '' || blockEl.innerHTML === '<br>');

    const landing = document.createElement('p');
    landing.appendChild(document.createElement('br'));

    if (isEmptyBlock && blockEl) {
      blockEl.replaceWith(fragment, landing);
    } else {
      const combined = document.createDocumentFragment();
      combined.append(fragment, landing);
      range.insertNode(combined);
    }

    const newRange = document.createRange();
    newRange.setStart(landing, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    emitChange();
  }

  function insertInlineCode() {
    const editor = editorRef.current;
    editor?.focus();
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const code = document.createElement('code');
    code.textContent = 'code';
    range.insertNode(code);
    // A caret merely adjacent to the <code> element (even outside it) is still
    // enough for Chrome to carry the formatting onto the next line on Enter.
    // A real text node after it breaks that adjacency.
    const spacer = document.createTextNode('​');
    code.after(spacer);
    range.setStart(spacer, 1);
    range.setEnd(spacer, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    emitChange();
  }

  function setLink() {
    const url = window.prompt('Link URL', 'https://');
    if (url === null) return;
    if (!url.trim()) {
      runCommand('unlink');
      return;
    }
    runCommand('createLink', url.trim());
  }

  function insertTable() {
    insertHtml(
      '<table><thead><tr><th>Header</th><th>Header</th><th>Header</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table><p></p>',
    );
  }

  function insertTaskList() {
    insertHtml(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul><p></p>',
    );
  }

  function handleEditorMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    const li = (event.target as HTMLElement).closest('li[data-type="taskItem"]') as HTMLElement | null;
    if (!li || !editorRef.current?.contains(li)) return;
    // Only the checkbox glyph (drawn via ::before, left of the text) toggles state.
    if (event.clientX - li.getBoundingClientRect().left > 24) return;
    // Native caret placement in contentEditable happens on mousedown, before a
    // 'click' handler would ever run — preventDefault has to happen here, or
    // the click still drops the editing caret into this list item, corrupting
    // whatever the user inserts next (mirrors ToolbarButton's onMouseDown guard).
    event.preventDefault();
    li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
    emitChange();
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items || !onImagePaste) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const url = await onImagePaste(file);
        if (url) insertHtml(`<img src="${url}" alt="" />`);
        return;
      }
    }
  }

  const activeHeading = HEADING_OPTIONS.find((option) => option.tag === activeBlock) ?? HEADING_OPTIONS[0];
  const ActiveHeadingIcon = activeHeading.icon;

  return (
    <div className="rounded-md border border-input bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-2 py-1">
        <div className="relative">
          <ToolbarButton onClick={() => setShowHeadingMenu((v) => !v)} title="Text style">
            <ActiveHeadingIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          {showHeadingMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowHeadingMenu(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-md border border-input bg-popover py-1 shadow-md">
                {HEADING_OPTIONS.map(({ tag, label, icon: Icon }) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      runCommand('formatBlock', tag);
                      setShowHeadingMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Divider />
        <ToolbarButton onClick={() => runCommand('bold')} title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => runCommand('italic')} title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => runCommand('underline')} title="Underline">
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => runCommand('strikeThrough')} title="Strikethrough">
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>

        <Divider />
        <ToolbarButton onClick={() => runCommand('formatBlock', 'BLOCKQUOTE')} title="Quote">
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={insertInlineCode} title="Inline Code">
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertHtml('<pre><code></code></pre><p></p>')} title="Code Block">
          <FileCode className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={setLink} title="Link">
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        <Divider />
        <ToolbarButton onClick={() => runCommand('insertUnorderedList')} title="Bullet List">
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => runCommand('insertOrderedList')} title="Numbered List">
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={insertTaskList} title="Task List">
          <ListChecks className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={insertTable} title="Insert Table">
          <TableIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        <Divider />
        <ToolbarButton onClick={() => runCommand('undo')} title="Undo">
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => runCommand('redo')} title="Redo">
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="ml-auto">
          <ToolbarButton
            onClick={() => setIsExpanded((v) => !v)}
            title={isExpanded ? 'Collapse editor' : 'Expand editor'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </ToolbarButton>
        </div>
      </div>
      <div
        ref={editorRef}
        className={`${styles.editor} ${isExpanded ? styles.expanded : styles.collapsed}`}
        contentEditable
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={emitChange}
        onPaste={handlePaste}
        onMouseDown={handleEditorMouseDown}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onMouseUp={refreshActiveBlock}
        onKeyUp={refreshActiveBlock}
      />
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-border" />;
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      className="flex items-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}
