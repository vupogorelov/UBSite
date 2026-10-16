<script>
  import { tts, toggle, paragraph, stop, setVoice } from '../lib/tts.svelte.js';
  import { clock } from '../lib/clock.js';
  import Icon from './Icon.svelte';

  /**
   * The computer's player: a small pill floating over the book while reading aloud — ⏮ ▶/■ ⏭, where
   * the voice is (the paragraph; a recording — the place in its file), the speed (a tap — the next
   * one), × — stop and close. The phone's player in miniature.
   */
  const recording = $derived(tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang));
  const rateKey = $derived(recording ? 'audioRate' : 'rate');
  const rate = $derived(tts[tts.lang][rateKey]);
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function nextRate() {
    const i = RATES.findIndex((r) => r > rate + 0.01);
    setVoice(rateKey, RATES[i < 0 ? 0 : i]);
  }
  const where = $derived(tts.place?.key?.includes(':') ? tts.place.key : tts.place ? `Текст ${tts.place.paper}` : '');
</script>

<div class="mini-player" role="region" aria-label="Аудиочтение">
  <button class="mini-btn" onclick={() => paragraph(-1)} aria-label="Предыдущий абзац" title="Предыдущий абзац"><Icon name="skip-back" size={16} /></button>
  <button class="mini-play" onclick={toggle} aria-label={tts.playing ? 'Остановить' : 'Читать'} title={tts.playing ? 'Остановить' : 'Читать'}>
    <Icon name={tts.playing ? 'pause' : 'play'} size={18} />
  </button>
  <button class="mini-btn" onclick={() => paragraph(1)} aria-label="Следующий абзац" title="Следующий абзац"><Icon name="skip-forward" size={16} /></button>
  <span class="mini-where">
    <b>{where}</b>
    <span>· {recording ? (tts.track && tts.track.duration ? `${clock(tts.track.time)} / ${clock(tts.track.duration)}` : 'запись') : tts.lang === 'ru' ? 'синтез речи' : 'English'}</span>
  </span>
  <button class="mini-rate" onclick={nextRate} title="Скорость: нажмите, чтобы изменить" aria-label="Скорость {rate}×">{Number(rate.toFixed(2))}×</button>
  <button class="mini-btn" onclick={stop} aria-label="Закрыть плеер" title="Остановить и закрыть"><Icon name="close" size={16} /></button>
</div>
