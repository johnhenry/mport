// Plain bare imports: these resolve through the import map startup() injected.
import { h, render } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { App } from "./startup-view.mjs";

export const mount = (el, props) => render(h(App({ h, useState, htm }), props), el);
