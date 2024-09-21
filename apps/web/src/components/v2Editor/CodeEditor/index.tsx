import * as Y from 'yjs'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import {
  Annotation,
  ChangeSpec,
  EditorState,
  StateField,
} from '@codemirror/state'
import { vscodeKeymap } from '@replit/codemirror-vscode-keymap'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import {
  EditorView,
  rectangularSelection,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  keymap,
} from '@codemirror/view'
import { history } from '@codemirror/commands'
import {
  indentOnInput,
  foldGutter,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, autocompletion } from '@codemirror/autocomplete'
import useEditorAwareness from '@/hooks/useEditorAwareness'

export const basicSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
]

export function getExtensions(language: 'python' | 'sql') {
  return [
    basicSetup,
    keymap.of(vscodeKeymap),
    ...(language === 'python' ? [python()] : language === 'sql' ? [sql()] : []),
  ]
}

export function createTextSync(source: Y.Text) {
  return StateField.define({
    create() {
      return source
    },
    update: (value: Y.Text, tr) => {
      if (tr.annotation(IsLocalAnnotation)) {
        return value
      }

      const operation = () => {
        tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
          value.delete(fromA, toA - fromA)
          value.insert(fromB, inserted.toString())
        })
      }

      if (value.doc) {
        value.doc.transact(operation)
      } else {
        operation()
      }

      return value
    },
  })
}

const IsLocalAnnotation = Annotation.define<boolean>()

function brieferKeyMaps(cbs: {
  onBlur: () => void
  onEditWithAI: () => void
  onRun: () => void
  onRunSelectNext: () => void
  onRunInsertBlock: () => void
}) {
  return [
    keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          view.contentDOM.blur()
          cbs.onBlur()
          return true
        },
      },
      {
        // command|ctrl + e
        key: 'Mod-e',
        run: () => {
          cbs.onEditWithAI()
          return true
        },
      },
      {
        // command|ctrl + enter
        key: 'Mod-Enter',
        run: () => {
          cbs.onRun()
          return true
        },
      },
      {
        // shift + enter
        key: 'Shift-Enter',
        run: () => {
          cbs.onRunSelectNext()
          return true
        },
      },
      {
        // alt enter
        key: 'Alt-Enter',
        run: () => {
          cbs.onRunInsertBlock()
          return true
        },
      },
    ]),
  ]
}

export type CodeEditor = {
  focus: () => void
}

interface Props {
  source: Y.Text
  language: 'python' | 'sql'
  readOnly: boolean
  onEditWithAI: () => void
  onRun: () => void
  onSelectNext: () => void
  onInsertBlock: () => void
}
export const CodeEditor = forwardRef<CodeEditor, Props>((props, ref) => {
  const { interactionState, setInteractionState } = useEditorAwareness()
  const onBlur = useCallback(() => {
    setInteractionState((prev) => ({ ...prev, mode: 'normal' }))
  }, [])

  const onRunInsertBlock = useCallback(() => {
    props.onRun()
    props.onInsertBlock()
  }, [props.onRun, props.onInsertBlock])

  const onRunSelectNext = useCallback(() => {
    props.onRun()
    props.onSelectNext()
  }, [props.onRun, props.onSelectNext])

  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  console.log(interactionState)
  const onClick: React.MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      e.preventDefault()
      setInteractionState((prev) => ({ ...prev, mode: 'insert' }))
    },
    [setInteractionState]
  )

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (editorViewRef.current) {
          editorViewRef.current.focus()
        }
      },
    }),
    [editorViewRef]
  )

  useEffect(() => {
    if (!editorRef.current) {
      return
    }

    const yTextSync = createTextSync(props.source)

    const editorView = new EditorView({
      state: EditorState.create({
        extensions: [
          ...getExtensions(props.language),
          EditorState.readOnly.of(props.readOnly),
          yTextSync,
          brieferKeyMaps({
            onBlur,
            onEditWithAI: props.onEditWithAI,
            onRun: props.onRun,
            onRunSelectNext,
            onRunInsertBlock,
          }),
        ],
        doc: props.source.toString(),
      }),
      parent: editorRef.current,
    })

    editorViewRef.current = editorView
    return () => {
      editorView.destroy()
    }
  }, [
    props.source,
    props.language,
    props.readOnly,
    editorRef,
    onBlur,
    props.onEditWithAI,
    props.onRun,
    onRunSelectNext,
    onRunInsertBlock,
  ])

  useEffect(() => {
    if (!editorViewRef.current) {
      return
    }

    const editorView = editorViewRef.current

    const observer = (e: Y.YTextEvent, tr: Y.Transaction) => {
      editorView.state.selection
      if (tr.local) {
        return
      }

      const changeSpecs: ChangeSpec[] = []
      let pos = 0
      for (const change of e.delta) {
        if (change.insert) {
          const text =
            typeof change.insert === 'string'
              ? change.insert
              : Array.isArray(change.insert)
              ? change.insert.join('')
              : ''
          changeSpecs.push({
            from: pos,
            insert: text,
          })
          pos += text.length
        } else if (change.delete) {
          changeSpecs.push({
            from: pos,
            to: pos + change.delete,
            insert: '',
          })
          pos += change.delete
        } else if (change.retain) {
          pos += change.retain
        }
      }

      const transaction = editorView.state.update({
        changes: changeSpecs,
        annotations: [IsLocalAnnotation.of(true)],
      })

      editorView.dispatch(transaction)
    }

    props.source.observe(observer)

    return () => {
      props.source.unobserve(observer)
    }
  }, [editorViewRef, props.source])

  return <div ref={editorRef} onClick={onClick}></div>
})
