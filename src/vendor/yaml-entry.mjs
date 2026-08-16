// Source wrapper for the only generated plugin artifact. The installed plugin
// must parse YAML without resolving `node_modules`, so the pinned `yaml`
// development dependency is bundled into `plugin/lib/vendor/yaml.mjs`.
export { parseDocument } from "yaml";
