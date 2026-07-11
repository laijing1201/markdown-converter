import { useState, useEffect } from 'react'

interface SmartFormatModalProps {
  onApply: () => void
  onClose: () => void
}

export default function SmartFormatModal({ onApply, onClose }: SmartFormatModalProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Fake progress animation
    const duration = 2000 // 2 seconds total
    const interval = 50
    const steps = duration / interval
    let currentStep = 0

    const timer = setInterval(() => {
      currentStep++
      const newProgress = Math.min((currentStep / steps) * 100, 100)
      setProgress(newProgress)
      
      if (currentStep >= steps) {
        clearInterval(timer)
        setTimeout(() => {
          onApply()
        }, 400) // slight delay before closing
      }
    }, interval)

    return () => clearInterval(timer)
  }, [onApply])

  let statusText = '正在初始化全能排版引擎...'
  if (progress > 5) statusText = '正在剔除页眉页脚与干扰字符...'
  if (progress > 15) statusText = '正在进行 PDF 断行智能缝合...'
  if (progress > 30) statusText = '正在进行中英文排版与标点规范化...'
  if (progress > 45) statusText = '正在结合上下文推断多级标题与列表...'
  if (progress > 60) statusText = '正在探测引用块与代码片段...'
  if (progress > 75) statusText = '正在提取并组装纯文本数据表格...'
  if (progress > 90) statusText = '正在美化超链接与参考文献...'
  if (progress > 95) statusText = '结构重组完成，正在生成...'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 border border-blue-500/30">
        
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="text-2xl">✨</span> 
            智能排版大脑
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6">
          <div className="h-32 bg-gray-50 dark:bg-gray-900 rounded-lg flex items-center justify-center p-4 border border-gray-100 dark:border-gray-700 overflow-hidden relative">
            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(90deg, transparent 50%, rgba(59, 130, 246, 0.5) 50%)', backgroundSize: '20px 20px' }}></div>
            
            <div className="text-center z-10">
              <div className="text-4xl mb-2 animate-bounce">🤖</div>
              <div className="text-sm font-mono text-blue-600 dark:text-blue-400 animate-pulse">
                {statusText}
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-2 font-mono">
              <span>SCANNING_DOCUMENT</span>
              <span>{Math.floor(progress)}%</span>
            </div>
            
            <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-75 ease-linear relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute top-0 right-0 bottom-0 left-0 bg-white/20 animate-pulse"></div>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-400 dark:text-gray-500 text-center font-mono">
            利用上下文关联算法，精准推断层级与结构
          </div>
        </div>
      </div>
    </div>
  )
}
