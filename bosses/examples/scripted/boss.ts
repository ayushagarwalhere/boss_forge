export function* script(api) {
  yield api.say('A little extra theater.');
  yield api.wait(3000);
  yield api.telegraph(480, 160, 90, 500);
  yield api.wait(500);
  yield api.say('Still room to breathe.');
}
