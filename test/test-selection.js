const {schema, sameDoc, doc, blockquote, pre, p, li, ul, img, br, hr} = require("prosemirror-model/test/build")
const {TestState} = require("./state")
const ist = require("ist")

describe("Selection", () => {
  it("should follow changes", () => {
    let state = new TestState({doc: doc(p("hi")), schema})
    state.apply(state.tr.insertText("xy", 1))
    ist(state.selection.head, 3)
    ist(state.selection.anchor, 3)
    state.apply(state.tr.insertText("zq", 1))
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
    state.apply(state.tr.insertText("uv", 7))
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
  })

  it("should move after inserted content", () => {
    let state = new TestState({doc: doc(p("hi")), schema})
    state.textSel(2, 3)
    state.apply(state.tr.insertText("o"))
    ist(state.selection.head, 3)
    ist(state.selection.anchor, 3)
  })

  it("moves after an inserted leaf node", () => {
    let state = new TestState({doc: doc(p("foobar")), schema})
    state.textSel(4)
    state.apply(state.tr.replaceSelection(schema.node("horizontal_rule")))
    ist(state.doc, doc(p("foo"), hr, p("bar")), sameDoc)
    ist(state.selection.head, 7)
    state.textSel(10)
    state.apply(state.tr.replaceSelection(schema.node("horizontal_rule")))
    ist(state.doc, doc(p("foo"), hr, p("bar"), hr), sameDoc)
    ist(state.selection.from, 11)
  })

  it("allows typing over a leaf node", () => {
    let state = new TestState({doc: doc(p("a"), "<a>", hr, p("b")), schema})
    state.nodeSel(3)
    state.apply(state.tr.replaceSelection(schema.text("x")))
    ist(state.doc, doc(p("a"), p("x"), p("b")), sameDoc)
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
  })

  it("allows deleting a selected block", () => {
    let state = new TestState({doc: doc(p("foo"), ul(li(p("bar")), li(p("baz")), li(p("quux")))), schema})
    state.nodeSel(0)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("bar")), li(p("baz")), li(p("quux")))), sameDoc)
    ist(state.selection.head, 3)
    state.nodeSel(2)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("baz")), li(p("quux")))), sameDoc)
    ist(state.selection.head, 3)
    state.nodeSel(9)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("baz")))), sameDoc)
    ist(state.selection.head, 6)
    state.nodeSel(0)
    state.deleteSelection()
    ist(state.doc, doc(p()), sameDoc)
  })

  it("allows deleting a leaf", () => {
    let state = new TestState({doc: doc(p("a"), hr, hr, p("b")), schema})
    state.nodeSel(3)
    state.deleteSelection()
    ist(state.doc, doc(p("a"), hr, p("b")), sameDoc)
    ist(state.selection.from, 3)
    state.deleteSelection()
    ist(state.doc, doc(p("a"), p("b")), sameDoc)
    ist(state.selection.head, 4)
  })

  it("properly handles deleting the selection", () => {
    let state = new TestState({doc: doc(p("foo", img, "bar"), blockquote(p("hi")), p("ay")), schema})
    state.nodeSel(4)
    state.apply(state.tr.replaceSelection(null))
    ist(state.doc, doc(p("foobar"), blockquote(p("hi")), p("ay")), sameDoc)
    ist(state.selection.head, 4)
    state.nodeSel(9)
    state.apply(state.tr.deleteSelection())
    ist(state.doc, doc(p("foobar"), p("ay")), sameDoc)
    ist(state.selection.from, 9)
    state.nodeSel(8)
    state.apply(state.tr.deleteSelection())
    ist(state.doc, doc(p("foobar")), sameDoc)
    ist(state.selection.from, 7)
  })

  it("can replace inline selections", () => {
    let state = new TestState({doc: doc(p("foo", img, "bar", img, "baz")), schema})
    state.nodeSel(4)
    state.apply(state.tr.replaceSelection(schema.node("hard_break")))
    ist(state.doc, doc(p("foo", br, "bar", img, "baz")), sameDoc)
    ist(state.selection.head, 5)
    ist(state.selection.empty)
    state.nodeSel(8)
    state.apply(state.tr.replaceSelection(schema.text("abc")))
    ist(state.doc, doc(p("foo", br, "barabcbaz")), sameDoc)
    ist(state.selection.head, 11)
    ist(state.selection.empty)
    state.nodeSel(0)
    state.apply(state.tr.replaceSelection(schema.text("xyz")))
    ist(state.doc, doc(p("xyz")), sameDoc)
  })

  it("can replace a block selection", () => {
    let state = new TestState({doc: doc(p("abc"), hr, hr, blockquote(p("ow"))), schema})
    state.nodeSel(5)
    state.apply(state.tr.replaceSelection(schema.node("code_block")))
    ist(state.doc, doc(p("abc"), pre(), hr, blockquote(p("ow"))), sameDoc)
    ist(state.selection.from, 7)
    state.nodeSel(8)
    state.apply(state.tr.replaceSelection(schema.node("paragraph")))
    ist(state.doc, doc(p("abc"), pre(), hr, p()), sameDoc)
    ist(state.selection.from, 9)
  })
})
