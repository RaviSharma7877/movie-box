const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

test("Downloads renders the shared folder and keeps video actions on their own cards", () => {
  const file = join(__dirname, "../src/screens/DownloadsScreen.jsx");
  const { code } = transformFileSync(file, {
    configFile: false,
    babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
  });
  const saved = { id: "saved", title: "Saved video", status: "done", fileSize: 100, galleryUri: "content://media/video/1" };
  const retained = { ...saved, id: "retained", galleryUri: null, galleryError: "Not enough space" };
  const moving = { ...saved, id: "moving", galleryUri: null, galleryPending: true };
  const folder = "Internal storage → Movies → MovieBox";
  const react = {
    useEffect: () => {},
    useCallback: callback => callback,
    useMemo: callback => callback(),
    useState: initial => [initial, () => {}],
    createElement: (type, props, ...children) => ({ type, props, children }),
  };
  const modules = {
    react,
    "react-native": { View: "View", Text: "Text", FlatList: "FlatList" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect: () => {} },
    "lucide-react-native": {},
    "../hooks/useDownloadQueue": { useDownloadQueue: () => ({ queue: [saved, retained, moving] }) },
    "../components/Primitives": { Action: "Action" },
    "../theme": { colors: {}, ui: {} },
    "../services/downloadManager": {},
    "../services/savedDownloadGroups": {
      groupSavedDownloads: items => items,
      formatStorage: () => "0.0 MB",
    },
    "../services/videoLibrary": { galleryAvailable: true, galleryFolder: folder },
    "expo-file-system": {},
  };
  const exports = {};
  runInNewContext(code, { exports, require: name => modules[name] });
  const list = exports.default({ navigation: {} }).children[0].props;
  const content = node => node == null ? []
    : Array.isArray(node) ? node.flatMap(content)
      : typeof node === "object" ? [node, ...content(node.children)] : [node];
  const actions = item => content(list.renderItem({ item })).filter(node => node?.type === "Action");
  assert.ok(content(list.ListHeaderComponent).includes(folder));
  assert.ok(actions(saved).some(node => node.props.title === "Open in another app"));
  assert.ok(actions(retained).some(node => node.props.title === "Retry saving to Gallery"));
  assert.ok(actions(moving).some(node => node.props.title === "Play" && node.props.disabled));
});
