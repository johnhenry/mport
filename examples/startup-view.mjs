// The app, written against injected dependencies so it can run either through
// the native import map (startup-app.mjs) or router.import() (the fallback).
export const App = ({ h, useState, htm }) => {
  const html = htm.bind(h);
  return function TodoApp({ lock }) {
    const [todos, setTodos] = useState([
      { text: "Resolve react@^19 once", done: true },
      { text: "Let any mirror of the same build serve it", done: false },
    ]);
    const [text, setText] = useState("");
    const add = (e) => {
      e.preventDefault();
      if (text.trim()) setTodos([...todos, { text: text.trim(), done: false }]), setText("");
    };
    const toggle = (i) => setTodos(todos.map((t, j) => (j === i ? { ...t, done: !t.done } : t)));
    const pkgs = Object.values(lock.packages);
    return html`
      <form onSubmit=${add}>
        <input type="text" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Add a todo" aria-label="New todo" />
        <button class="primary">Add</button>
      </form>
      ${todos.map((t, i) => html`
        <label class="todo ${t.done ? "done" : ""}">
          <input type="checkbox" checked=${t.done} onChange=${() => toggle(i)} /><span>${t.text}</span>
        </label>`)}
      <p class="status">
        rendered with ${pkgs.map((p) => `${p.specifier.replace(/@[^/@]+(?=\/|$)/, "")} → ${p.version} (${p.provider})`).join(" · ")}
      </p>`;
  };
};
