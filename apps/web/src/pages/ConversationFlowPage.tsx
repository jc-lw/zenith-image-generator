import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageNode } from '@/components/flow/MessageNode'
import { useConversationFlowStore } from '@/stores/conversationFlowStore'

const nodeTypes = {
  message: MessageNode,
}

// Custom edge styles
const edgeStyles = {
  active: {
    stroke: '#f97316',
    strokeWidth: 2,
  },
  inactive: {
    stroke: '#3f3f46',
    strokeWidth: 1.5,
  },
}

function ConversationFlowCanvas() {
  const { setCenter } = useReactFlow()

  const {
    nodes,
    edges,
    activeNodeId,
    addMessage,
    setActiveNode,
    clearFlow,
    setNodes,
  } = useConversationFlowStore()

  const [inputValue, setInputValue] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Handle node click to set active node
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setActiveNode(node.id)
    },
    [setActiveNode]
  )

  // Handle canvas click to deselect
  const onPaneClick = useCallback(() => {
    // Don't deselect - keep the last active node
  }, [])

  // Handle sending a message
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isThinking) return

    const userContent = inputValue.trim()
    setInputValue('')

    // Add user message
    const userNodeId = addMessage(activeNodeId, userContent, 'user')

    // Simulate AI thinking
    setIsThinking(true)

    // Auto-pan to new node
    setTimeout(() => {
      const userNode = useConversationFlowStore.getState().nodes.find(n => n.id === userNodeId)
      if (userNode) {
        setCenter(userNode.position.x + 160, userNode.position.y + 90, { zoom: 1, duration: 500 })
      }
    }, 100)

    // Simulate AI response (replace with actual API call)
    setTimeout(() => {
      const aiResponse = generateMockAIResponse(userContent)
      const aiNodeId = addMessage(userNodeId, aiResponse, 'ai')

      // Auto-pan to AI response
      setTimeout(() => {
        const aiNode = useConversationFlowStore.getState().nodes.find(n => n.id === aiNodeId)
        if (aiNode) {
          setCenter(aiNode.position.x + 160, aiNode.position.y + 90, { zoom: 1, duration: 500 })
        }
      }, 100)

      setIsThinking(false)
    }, 1500)
  }, [inputValue, isThinking, activeNodeId, addMessage, setCenter])

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    },
    [handleSendMessage]
  )

  // Handle clear confirmation
  const handleClear = useCallback(() => {
    if (window.confirm('Clear all messages? This cannot be undone.')) {
      clearFlow()
    }
  }, [clearFlow])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Fit view when nodes change significantly
  useEffect(() => {
    if (nodes.length > 0) {
      // Optional: auto-fit on first load
    }
  }, [nodes.length])

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="text-orange-500" size={20} />
            <span className="text-lg font-semibold text-zinc-100">
              Conversation Flow
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            disabled={nodes.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </header>

      {/* Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodesChange={(changes) => {
            // Handle node position changes from dragging
            const state = useConversationFlowStore.getState()
            const updatedNodes = [...state.nodes]
            for (const change of changes) {
              if (change.type === 'position' && change.position) {
                const nodeIndex = updatedNodes.findIndex(n => n.id === change.id)
                if (nodeIndex !== -1) {
                  updatedNodes[nodeIndex] = {
                    ...updatedNodes[nodeIndex],
                    position: change.position,
                  }
                }
              }
            }
            setNodes(updatedNodes)
          }}
          onEdgesChange={() => {}}
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: edgeStyles.inactive,
          }}
          proOptions={{ hideAttribution: true }}
          className="conversation-flow-canvas"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#27272a"
          />
          <Controls
            className="!bg-zinc-800/90 !border-zinc-700 !rounded-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:hover:!bg-zinc-700 [&>button>svg]:!fill-zinc-400"
            showInteractive={false}
          />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as { role: string; isOnActivePath: boolean }
              if (data.isOnActivePath) return '#f97316'
              return data.role === 'user' ? '#3f3f46' : '#27272a'
            }}
            maskColor="rgba(0, 0, 0, 0.8)"
            className="!bg-zinc-900/90 !border-zinc-700 !rounded-lg"
          />
        </ReactFlow>

        {/* Empty State */}
        <AnimatePresence>
          {nodes.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                  <MessageSquarePlus size={32} className="text-zinc-500" />
                </div>
                <h2 className="text-lg font-medium text-zinc-400 mb-1">
                  Start a conversation
                </h2>
                <p className="text-sm text-zinc-500">
                  Type a message below to begin your multi-thread flow
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Input Dock */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-20">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative rounded-2xl bg-zinc-900/95 border border-zinc-700/50 shadow-2xl backdrop-blur-xl"
        >
          {/* Active node indicator */}
          {activeNodeId && (
            <div className="absolute -top-8 left-4 flex items-center gap-2 px-2 py-1 rounded-t-lg bg-zinc-800/90 text-xs text-zinc-400">
              <span>Replying to</span>
              <span className="text-orange-400 font-medium">{activeNodeId}</span>
            </div>
          )}

          <div className="flex items-end gap-3 p-4">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeNodeId ? 'Continue the conversation...' : 'Start a new conversation...'}
              rows={1}
              className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 resize-none outline-none text-sm leading-relaxed max-h-32"
              style={{
                height: 'auto',
                minHeight: '24px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 128)}px`
              }}
            />

            <button
              type="button"
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isThinking}
              className={`
                flex items-center justify-center w-10 h-10 rounded-xl
                transition-all duration-200
                ${
                  inputValue.trim() && !isThinking
                    ? 'bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
                }
              `}
            >
              {isThinking ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-zinc-500 border-t-orange-500 rounded-full"
                />
              ) : (
                <Sparkles size={18} />
              )}
            </button>
          </div>

          {/* Hint */}
          <div className="px-4 pb-3 flex items-center justify-between text-[10px] text-zinc-500">
            <span>Press Enter to send, Shift+Enter for new line</span>
            {activeNodeId && (
              <button
                type="button"
                onClick={() => setActiveNode(null)}
                className="hover:text-zinc-300 transition-colors"
              >
                Clear selection to start new thread
              </button>
            )}
          </div>
        </motion.div>
      </div>

      {/* Custom styles */}
      <style>{`
        .conversation-flow-canvas .react-flow__edge.active-edge path {
          stroke: #f97316 !important;
          stroke-width: 2px !important;
        }

        .conversation-flow-canvas .react-flow__edge.inactive-edge path {
          stroke: #3f3f46 !important;
          stroke-width: 1.5px !important;
        }

        .conversation-flow-canvas .react-flow__edge.animated path {
          stroke-dasharray: 5;
          animation: dash 0.5s linear infinite;
        }

        @keyframes dash {
          to {
            stroke-dashoffset: -10;
          }
        }
      `}</style>
    </div>
  )
}

// Mock AI response generator (replace with actual API integration)
function generateMockAIResponse(userMessage: string): string {
  const responses = [
    `I understand you're asking about "${userMessage.slice(0, 30)}...". Let me think about this.\n\nHere's my analysis:\n\n1. **Key point**: This is an interesting topic\n2. **Consideration**: There are multiple approaches\n3. **Suggestion**: We could explore this further\n\nWould you like me to elaborate on any of these points?`,
    `That's a great question! Based on your input, here are my thoughts:\n\n- First, let's consider the context\n- Then, we can explore the possibilities\n- Finally, we'll arrive at a conclusion\n\n*What aspect would you like to dive deeper into?*`,
    `Interesting perspective! Here's how I see it:\n\n> "${userMessage.slice(0, 50)}..."\n\nThis raises several points worth discussing. The main considerations are:\n\n1. The technical aspects\n2. The practical implications\n3. The potential outcomes\n\nLet me know which direction you'd like to take this conversation.`,
  ]

  return responses[Math.floor(Math.random() * responses.length)]
}

export default function ConversationFlowPage() {
  return (
    <ReactFlowProvider>
      <ConversationFlowCanvas />
    </ReactFlowProvider>
  )
}
