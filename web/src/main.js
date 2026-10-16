// @ts-check
import './lib/polyfills.js';
import './lib/log.js'; // (first: the journal hears the failures of everything after it)
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { initPwa } from './lib/pwa.svelte.js';

initPwa();
mount(App, { target: /** @type {HTMLElement} */ (document.getElementById('app')) });
