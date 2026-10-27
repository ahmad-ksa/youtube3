// ❤ button in YouTube's OWN player control bar: adds / removes the playing video's channel to our favorites.
// Technique adapted from TizenTube (GPL-3.0, mods/ui/customUI.js): YouTube's TV app keeps its components in
// window._yttv; the player-actions component builds the bar's buttons from props.data.engagementActions, so we
// wrap that component and append one button whose command is handled by our resolveCommand hook.

const MARK = 'TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION';
const SRC = 'engagementActions';

/** Name of the instance method that returns the engagement-action buttons. */
function findMethod(inst, ctor) {
  // 1) a function property whose own source reads props.data.engagementActions
  for (const k of Object.keys(inst)) {
    const f = inst[k];
    if (typeof f === 'function') {
      try {
        if (Function.prototype.toString.call(f).includes(SRC)) return k;
      } catch {
        /* native */
      }
    }
  }
  // 2) the constructor assigns it: "this.X = …engagementActions…" (or "a.X = …" once minified)
  const code = Function.prototype.toString.call(ctor);
  const re = /\b[\w$]+\.([\w$]+)\s*=(?!=)/g;
  const hits = [];
  let m;
  while ((m = re.exec(code))) hits.push({ name: m[1], at: m.index });
  for (let i = 0; i < hits.length; i++) {
    const part = code.slice(hits[i].at, hits[i + 1]?.at ?? code.length);
    if (part.includes(SRC) && typeof inst[hits[i].name] === 'function')
      return hits[i].name;
  }
  return null;
}

/**
 * @param {() => {channelId:string, name:string}|null} current the playing video's channel
 * @param {(id:string) => boolean} isFav
 */
export function installPlayerButton(current, isFav) {
  const checked = new Set(); // _yttv keys already looked at (sources are large: look at each once)
  const apply = () => {
    const yt = window._yttv;
    // the player's components load with the first video
    if (!yt || !document.querySelector('video'))
      return void setTimeout(apply, 500);
    let key = null;
    for (const k of Object.keys(yt)) {
      if (checked.has(k)) continue;
      checked.add(k);
      try {
        if (
          typeof yt[k] === 'function' &&
          Function.prototype.toString.call(yt[k]).includes(MARK)
        ) {
          key = k;
          break;
        }
      } catch {
        /* not inspectable */
      }
    }
    if (!key) return void setTimeout(apply, 1000);
    const Orig = yt[key];
    if (Orig.__ytlg) return;
    const isClass = /^class[\s{]/.test(Function.prototype.toString.call(Orig));
    let method = null;
<<<<<<< HEAD
=======
    let logged = false;
>>>>>>> main

    function Wrapped(...args) {
      if (!(this instanceof Wrapped))
        return isClass
          ? Reflect.construct(Orig, args, Wrapped)
          : Orig.apply(this, args);
      let inst;
      if (isClass) inst = Reflect.construct(Orig, args, Wrapped);
      else {
        Orig.apply(this, args);
        inst = this;
      }
      try {
        method = method || findMethod(inst, Orig);
        const own = method && inst[method];
        if (typeof own === 'function') {
          inst[method] = function (...a) {
            const res = own.apply(this, a);
            try {
              if (Array.isArray(res) && !res.some((b) => b?.__ytlg)) {
<<<<<<< HEAD
=======
                if (!logged) {
                  logged = true;
                  console.info(
                    '[ytlg] ❤ added to the player bar (' + method + ')'
                  );
                }
>>>>>>> main
                const ch = current();
                const on = !!(ch && isFav(ch.channelId));
                res.push({
                  __ytlg: true,
                  type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                  button: {
                    buttonRenderer: {
                      isDisabled: false,
                      text: {
                        runs: [
                          {
                            text: on ? '💔 إزالة من المفضلة' : '❤ إضافة للمفضلة'
                          }
                        ]
                      },
                      icon: { iconType: 'LIKE' },
                      command: { ytlgCommand: { action: 'favoriteCurrent' } },
                      trackingParams: null
                    }
                  }
                });
              }
            } catch (e) {
              console.warn('[ytlg] player button', e);
            }
            return res;
          };
        } else console.warn('[ytlg] engagement actions method not found');
      } catch (e) {
        console.warn('[ytlg] player button', e);
      }
      return inst;
    }
    Wrapped.prototype = Orig.prototype;
    Object.setPrototypeOf(Wrapped, Orig); // static members keep working
    Wrapped.__ytlg = true;
    yt[key] = Wrapped;
    console.info('[ytlg] player ❤ button installed on', key);
  };
  apply();
}
