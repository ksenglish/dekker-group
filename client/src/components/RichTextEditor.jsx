import { useEffect, useRef } from 'react';
import styles from './RichTextEditor.module.css';

const FONT_SIZES = [12, 13, 14, 16, 18, 24];
const COLORS = ['#0f172a', '#dc2626', '#16a34a', '#0891b2', '#7c3aed', '#ea580c'];

// Lightweight WYSIWYG editor for the quote description field. Uses
// document.execCommand with styleWithCSS enabled so formatting comes out as
// span+style (not legacy <font>/<b> tags) — keeps the HTML predictable for
// the server-side sanitizer and the pdfkit renderer, which both only
// understand a small, known tag vocabulary.
export default function RichTextEditor({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const lastValue = useRef(value);

  useEffect(() => {
    if (editorRef.current && value !== lastValue.current && document.activeElement !== editorRef.current) {
      editorRef.current.innerHTML = value || '';
      lastValue.current = value;
    }
  }, [value]);

  function focusEditor() {
    editorRef.current?.focus();
  }

  function exec(command, arg) {
    focusEditor();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, arg);
    handleInput();
  }

  function applyFontSize(px) {
    focusEditor();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    try {
      range.surroundContents(span);
    } catch {
      const content = range.extractContents();
      span.appendChild(content);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    handleInput();
  }

  function handleInput() {
    const html = editorRef.current?.innerHTML || '';
    lastValue.current = html;
    onChange(html);
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button type="button" title="Bold" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" title="Italic" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" title="Underline" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('underline')}><u>U</u></button>

        <span className={styles.divider} />

        <select className={styles.select} title="Font size" defaultValue=""
          onMouseDown={e => e.preventDefault()}
          onChange={e => { if (e.target.value) applyFontSize(Number(e.target.value)); e.target.value = ''; }}>
          <option value="" disabled>Size</option>
          {FONT_SIZES.map(sz => <option key={sz} value={sz}>{sz}px</option>)}
        </select>

        <select className={styles.select} title="Text colour" defaultValue=""
          onMouseDown={e => e.preventDefault()}
          onChange={e => { if (e.target.value) exec('foreColor', e.target.value); e.target.value = ''; }}>
          <option value="" disabled>Colour</option>
          {COLORS.map(c => <option key={c} value={c} style={{ color: c }}>■ {c}</option>)}
        </select>

        <span className={styles.divider} />

        <button type="button" title="Bullet list" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>•≡</button>
        <button type="button" title="Numbered list" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('insertOrderedList')}>1≡</button>

        <span className={styles.divider} />

        <button type="button" title="Align left" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('justifyLeft')}>⇤</button>
        <button type="button" title="Align centre" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('justifyCenter')}>⇔</button>
        <button type="button" title="Align right" className={styles.toolBtn} onMouseDown={e => e.preventDefault()} onClick={() => exec('justifyRight')}>⇥</button>
      </div>
      <div
        ref={editorRef}
        className={styles.editor}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
      />
    </div>
  );
}
