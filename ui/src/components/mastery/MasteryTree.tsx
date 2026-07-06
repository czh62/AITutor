import { useState } from 'react'
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon
} from 'lucide-react'
import type { MasteryKnowledgePoint, MasteryModule } from '@/api/types'
import { cn } from '@/lib/utils'

interface MasteryTreeProps {
  modules: MasteryModule[]
  selectedKnowledgePointId?: string
  onKnowledgePointClick: (kp: MasteryKnowledgePoint, module: MasteryModule) => void
}

const TYPE_LABELS: Record<MasteryKnowledgePoint['knowledge_type'], string> = {
  memory: '记忆',
  concept: 'Concept',
  procedure: '程序',
  design: '设计'
}

function isDue(point: MasteryKnowledgePoint): boolean {
  if (!point.review_due) return false
  return new Date(point.review_due).getTime() <= Date.now()
}

function PointStatusIcon({ point }: { point: MasteryKnowledgePoint }) {
  if (point.has_pending_question) {
    return <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
  }
  if (isDue(point)) {
    return <ClockIcon className="h-4 w-4 text-sky-500" />
  }
  if (point.status === 'mastered') {
    return <CircleCheckIcon className="h-4 w-4 text-emerald-500" />
  }
  if (point.status === 'learning') {
    return <CircleDotIcon className="h-4 w-4 text-sky-500" />
  }
  return <CircleIcon className="h-4 w-4 text-muted-foreground" />
}

export default function MasteryTree({
  modules,
  selectedKnowledgePointId,
  onKnowledgePointClick
}: MasteryTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleModule = (moduleId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {modules.map((module) => {
        const isCollapsed = collapsed.has(module.id)
        const total = module.total ?? module.knowledge_points.length
        const mastered = module.mastered ?? module.knowledge_points.filter((point) => point.status === 'mastered').length
        return (
          <section key={module.id} className="rounded-md border border-border bg-background">
            <button
              type="button"
              onClick={() => toggleModule(module.id)}
              className="flex h-12 w-full items-center gap-2 px-3 text-left"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{module.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {mastered}/{total} Mastered
                </span>
              </span>
            </button>

            {!isCollapsed && (
              <div className="border-t border-border/70 p-1">
                {module.knowledge_points.map((point) => {
                  const active = selectedKnowledgePointId === point.id
                  return (
                    <button
                      key={point.id}
                      type="button"
                      onClick={() => onKnowledgePointClick(point, module)}
                      className={cn(
                        'grid h-[72px] w-full grid-cols-[24px_minmax(0,1fr)_48px] items-center gap-2 rounded-md px-2 text-left transition-colors',
                        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
                      )}
                    >
                      <span className="flex h-6 w-6 items-center justify-center">
                        <PointStatusIcon point={point} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{point.title}</span>
                        <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {point.description}
                        </span>
                      </span>
                      <span className="text-right text-[11px] text-muted-foreground">
                        <span className="block">{TYPE_LABELS[point.knowledge_type]}</span>
                        <span className="block">{point.mastery_level}%</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
