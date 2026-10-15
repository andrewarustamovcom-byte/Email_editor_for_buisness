export const styles = `
:host { all: initial; color-scheme: light; }
* { box-sizing: border-box; }
button,input,textarea,select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .45; }
button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible { outline: 3px solid #a394f9; outline-offset: 2px; }
.launcher { position: fixed; bottom: 24px; right: 24px; border: 0; border-radius: 18px; padding: 14px 20px; color: #fff; background: #40316d; box-shadow: 0 5px 24px #211b3d35; font: 600 14px/1.4 system-ui,sans-serif; }
.panel { position: fixed; right: 20px; top: 20px; width: 392px; max-width: calc(100vw - 32px); max-height: calc(100vh - 40px); overflow: auto; color: #292638; background: #fcfbfe; border: 1px solid #e4dfec; border-radius: 20px; box-shadow: 0 12px 64px #271b4630; font: 14px/1.5 system-ui,-apple-system,sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; padding: 20px 22px 14px; }
.brand { display: flex; gap: 10px; align-items: center; font-size: 19px; font-weight: 700; letter-spacing: -.5px; }
.logo { display: grid; place-items: center; background: #eae4f8; color: #584090; width: 32px; height: 32px; border-radius: 10px; }
.close { background: transparent; color: #787184; border: 0; font-size: 23px; padding: 0 5px; }
main { padding: 0 22px 22px; }
h1 { font-size: 21px; letter-spacing: -.6px; line-height: 1.3; margin: 12px 0 7px; }
p { margin: 6px 0 12px; }
.muted { color: #797184; font-size: 12px; }
.eyebrow { text-transform: uppercase; font-size: 10px; font-weight: 700; letter-spacing: 1.4px; color: #8c7cab; margin-top: 10px; }
.primary { border: 0; color: white; background: #5b428c; border-radius: 11px; padding: 12px 16px; width: 100%; font-weight: 600; margin: 12px 0; }
.secondary,.quiet { border: 1px solid #ded7eb; border-radius: 8px; padding: 7px 11px; background: #fff; color: #554377; }
.quiet { border-color: transparent; background: transparent; }
.controls { padding: 14px 0; border-top: 1px solid #eae6f0; }
label { display: flex; align-items: center; gap: 8px; }
input[type=checkbox] { accent-color: #6f509f; }
textarea,select { width: 100%; border: 1px solid #ddd6e8; border-radius: 9px; padding: 10px; color: #393043; background: #fff; margin: 7px 0; }
textarea { min-height: 100px; resize: vertical; }
.history { padding: 10px 0; }
.message { display: block; padding: 9px; border: 1px solid #e8e1ef; border-radius: 8px; margin: 6px 0; }
.message summary { cursor: pointer; }
.message pre { max-height: 120px; overflow: auto; white-space: pre-wrap; font: inherit; }
.notice,.error,.success { padding: 11px 13px; border-radius: 10px; background: #f2edf9; color: #66517f; font-size: 12px; margin: 10px 0; }
.error { background: #fbece8; color: #9c4236; }
.success { background: #edf6f1; color: #376b52; }
.summary { margin: 14px 0; }
.card { padding: 15px; background: #fff; border: 1px solid #e7e1ef; border-radius: 12px; margin: 10px 0; }
.card h2 { font-size: 14px; line-height: 1.4; margin: 5px 0 8px; }
.tag { font-size: 10px; font-weight: 600; color: #886626; background: #fbf3df; padding: 3px 7px; border-radius: 5px; }
.category { color: #8b7c9a; font-size: 10px; float: right; }
.card p { font-size: 12px; color: #6a6172; }
.diff { border-radius: 7px; padding: 9px 11px; font-size: 13px; margin: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.before { background: #fcf0ed; color: #92564d; text-decoration: line-through; }
.after { background: #edf5ef; color: #3e6e50; }
.diff-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; margin-top: 9px; color: #918699; }
.actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.accept { background: #5b428c; color: #fff; border: 0; border-radius: 7px; padding: 7px 11px; }
.category-list { display: flex; flex-wrap: wrap; gap: 5px; padding: 0; list-style: none; }
.category-list li { font-size: 10px; padding: 4px 7px; background: #f0edf5; border-radius: 5px; }
footer { font-size: 10px; color: #978c9f; border-top: 1px solid #eae6f0; padding-top: 13px; margin-top: 16px; }
`;
