// @ts-check
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { initPwa } from './lib/pwa.svelte.js';

initPwa();
mount(App, { target: /** @type {HTMLElement} */ (document.getElementById('app')) });
