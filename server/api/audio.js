// @ts-check
// The recorded reading: the catalog of files and the files themselves (for signed-in people).
import { STREAM } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../audio.js').createAudio>} audio
 */
export function registerAudioRoutes(router, audio) {
  router.on('GET', '/api/audio', () => audio.catalog());
  for (const method of ['GET', 'HEAD']) {
    router.on(method, '/api/audio/:lang/:file', ({ req, res, params }) => {
      audio.send(req, res, params.lang, params.file);
      return STREAM;
    });
  }
}
