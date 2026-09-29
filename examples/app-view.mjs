// The app, written against injected dependencies so it can run either through
// the native import map (app-main.mjs) or modules loaded with router.import().
export const App = ({ h, useState, htm }) => {
  const html = htm.bind(h);
  return function TodoApp({ sources }) {
    const [todos, setTodos] = useState([
      { text: "Resolve each package once", done: true },
      { text: "Let any mirror of the same build serve it", done: false },
    ]);
    const [text, setText] = useState("");
    const add = (e) => {
      e.preventDefault();
      if (text.trim()) setTodos([...todos, { text: text.trim(), done: false }]), setText("");
    };
    const toggle = (i) => setTodos(todos.map((t, j) => (j === i ? { ...t, done: !t.done } : t)));
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
        rendered with ${sources.map((p) => `${p.label} ${p.version} from ${p.provider}`).join(" · ")}
      </p>`;
  };
};
