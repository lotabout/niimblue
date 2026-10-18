import "$/styles/style.scss";
import "@popperjs/core";
import "toastify-js/src/toastify.css";
import "bootstrap/js/dist/dropdown";
import "bootstrap/js/dist/collapse";
import App from "$/App.svelte";
import { mount } from "svelte";
import { configureFabric } from "$/defaults";
import { loadEmojiFont } from "$/utils/emoji_font";

configureFabric();

const app = loadEmojiFont()
  .catch((error) => console.error("Unable to load the built-in emoji font:", error))
  .then(() => mount(App, {
    target: document.getElementById("app")!,
  }));

export default app;
