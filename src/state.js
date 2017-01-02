const {Node} = require("prosemirror-model")

const {Selection} = require("./selection")
const {Transaction} = require("./transaction")

function bind(f, self) {
  return !self || !f ? f : f.bind(self)
}

class FieldDesc {
  constructor(name, desc, self) {
    this.name = name
    this.init = bind(desc.init, self)
    this.apply = bind(desc.apply, self)
  }
}

const baseFields = [
  new FieldDesc("doc", {
    init(config) { return config.doc || config.schema.nodes.doc.createAndFill() },
    apply(tr) { return tr.doc }
  }),

  new FieldDesc("selection", {
    init(config, instance) { return config.selection || Selection.atStart(instance.doc) },
    apply(tr, selection) {
      if (tr.selectionSet) return tr.selection
      if (tr.steps.length) return selection.map(tr.doc, tr.mapping)
      return selection
    }
  }),

  new FieldDesc("storedMarks", {
    init() { return null },
    apply(tr, _marks, _old, state) { return state.selection.empty ? tr.storedMarks : null }
  }),

  new FieldDesc("scrollToSelection", {
    init() { return 0 },
    apply(tr, prev) { return tr.store.scrollIntoView ? prev + 1 : prev }
  })
]

// Object wrapping the part of a state object that stays the same
// across transactions. Stored in the state's `config` property.
class Configuration {
  constructor(schema, plugins) {
    this.schema = schema
    this.fields = baseFields.slice()
    this.plugins = []
    this.pluginsByKey = Object.create(null)
    if (plugins) plugins.forEach(plugin => {
      if (this.pluginsByKey[plugin.key])
        throw new RangeError("Adding different instances of a keyed plugin (" + plugin.key + ")")
      this.plugins.push(plugin)
      this.pluginsByKey[plugin.key] = plugin
      if (plugin.options.state)
        this.fields.push(new FieldDesc(plugin.key, plugin.options.state, plugin))
    })
  }
}

// ::- The state of a ProseMirror editor is represented by an object
// of this type. This is a persistent data structure—it isn't updated,
// but rather a new state value is computed from an old one with the
// [`apply`](#state.EditorState.apply) method.
//
// In addition to the built-in state fields, plugins can define
// additional pieces of state.
class EditorState {
  constructor(config) {
    this.config = config
  }

  // doc:: Node
  // The current document.

  // selection:: Selection
  // The selection.

  // storedMarks:: ?[Mark]
  // A set of marks to apply to the next character that's typed. Will
  // be null whenever no explicit marks have been set.

  // :: Schema
  // The schema of the state's document.
  get schema() {
    return this.config.schema
  }

  // :: [Plugin]
  // The plugins that are active in this state.
  get plugins() {
    return this.config.plugins
  }

  // :: (Transaction) → EditorState
  // Apply the given transaction to produce a new state.
  apply(tr) {
    if (!tr.before.eq(this.doc)) throw new RangeError("Applying a mismatched transaction")
    let newInstance = new EditorState(this.config), fields = this.config.fields
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i]
      newInstance[field.name] = field.apply(tr, this[field.name], this, newInstance)
    }
    for (let i = 0; i < applyListeners.length; i++) applyListeners[i](this, tr, newInstance)
    return newInstance
  }

  // :: Transaction
  // Start a [transaction](#state.Transaction) from this state.
  get tr() { return new Transaction(this) }

  // :: (Object) → EditorState
  // Create a state. `config` must be an object containing at least a
  // `schema` (the schema to use) or `doc` (the starting document)
  // property. When it has a `selection` property, that should be a
  // valid [selection](#state.Selection) in the given document, to use
  // as starting selection. Plugins, which are specified as an array
  // in the `plugins` property, may read additional fields from the
  // config object.
  static create(config) {
    let $config = new Configuration(config.schema || config.doc.type.schema, config.plugins)
    let instance = new EditorState($config)
    for (let i = 0; i < $config.fields.length; i++)
      instance[$config.fields[i].name] = $config.fields[i].init(config, instance)
    return instance
  }

  // :: (Object) → EditorState
  // Create a new state based on this one, but with an adjusted set of
  // active plugins. State fields that exist in both sets of plugins
  // are kept unchanged. Those that no longer exist are dropped, and
  // those that are new are initialized using their
  // [`init`](#state.StateField.init) method, passing in the new
  // configuration object..
  reconfigure(config) {
    let $config = new Configuration(config.schema || this.schema, config.plugins)
    let fields = $config.fields, instance = new EditorState($config)
    for (let i = 0; i < fields.length; i++) {
      let name = fields[i].name
      instance[name] = this.hasOwnProperty(name) ? this[name] : fields[i].init(config, instance)
    }
    return instance
  }

  // :: (?Object<Plugin>) → Object
  // Serialize this state to JSON. If you want to serialize the state
  // of plugins, pass an object mapping property names to use in the
  // resulting JSON object to plugin objects.
  toJSON(pluginFields) {
    let result = {doc: this.doc.toJSON(), selection: this.selection.toJSON()}
    if (pluginFields) for (let prop in pluginFields) {
      if (prop == "doc" || prop == "selection")
        throw new RangeError("The JSON fields `doc` and `selection` are reserved")
      let plugin = pluginFields[prop], state = plugin.options.state
      if (state && state.toJSON) result[prop] = state.toJSON.call(plugin, this[plugin.key])
    }
    return result
  }

  // :: (Object, Object, ?Object<Plugin>) → EditorState
  // Deserialize a JSON representation of a state. `config` should
  // have at least a `schema` field, and should contain array of
  // plugins to initialize the state with. `pluginFields` can be used
  // to deserialize the state of plugins, by associating plugin
  // instances with the property names they use in the JSON object.
  static fromJSON(config, json, pluginFields) {
    if (!config.schema) throw new RangeError("Required config field 'schema' missing")
    let $config = new Configuration(config.schema, config.plugins)
    let instance = new EditorState($config)
    $config.fields.forEach(field => {
      if (field.name == "doc") {
        instance.doc = Node.fromJSON(config.schema, json.doc)
      } else if (field.name == "selection") {
        instance.selection = Selection.fromJSON(instance.doc, json.selection)
      } else {
        if (pluginFields) for (let prop in pluginFields) {
          let plugin = pluginFields[prop], state = plugin.options.state
          if (plugin.key == field.name && state && state.fromJSON &&
              Object.prototype.hasOwnProperty.call(json, prop)) {
            // This field belongs to a plugin mapped to a JSON field, read it from there.
            instance[field.name] = state.fromJSON.call(plugin, config, json[prop], instance)
            return
          }
        }
        instance[field.name] = field.init(config, instance)
      }
    })
    return instance
  }

  // Kludge to allow the view to track mappings between different
  // instances of a state.
  static addApplyListener(f) {
    applyListeners.push(f)
  }
  static removeApplyListener(f) {
    let found = applyListeners.indexOf(f)
    if (found > -1) applyListeners.splice(found, 1)
  }
}
exports.EditorState = EditorState

const applyListeners = []
