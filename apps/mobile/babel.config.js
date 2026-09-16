// babel-preset-expo가 reanimated 플러그인을 자동으로 포함한다(SDK 53+).
// 그래도 파일을 명시해 두는 이유: 나중에 플러그인을 하나라도 추가할 때
// 여기가 없으면 "왜 안 먹지"로 30분을 쓴다. 플러그인 순서도 여기서만 보인다.
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
