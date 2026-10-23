import {
  LucideBaby,
  LucideBookOpen,
  LucideCalendarDays,
  LucideChurch,
  LucideDrum,
  LucideFlower,
  LucideGem,
  LucideHandHeart,
  LucideHandshake,
  LucideFlower2,
  LucideHeart,
  LucideLandmark,
  LucideMessageCircle,
  LucidePlane,
  LucideScroll,
  LucideSparkles,
  LucideUsers,
  type LucideIcon,
} from '@lucide/angular';
import { EVENT_KIND_LABELS, STORY_KIND_LABELS, type EventKind, type StoryKind, type TimelineItem } from '@fh/contracts';
import { t } from '../../core/i18n/i18n';

export const TIMELINE_ICONS: Record<EventKind | StoryKind, LucideIcon> = {
  birth: LucideBaby,
  death: LucideFlower2,
  marriage: LucideHeart,
  reunion: LucideUsers,
  migration: LucidePlane,
  tradition: LucideDrum,
  historical: LucideLandmark,
  other: LucideCalendarDays,
  naming: LucideBaby,
  engagement: LucideHandshake,
  wedding: LucideGem,
  funeral: LucideFlower2,
  one_week: LucideFlower,
  memorial: LucideHandHeart,
  thanksgiving: LucideChurch,
  story: LucideBookOpen,
  oral_history: LucideMessageCircle,
  memory: LucideSparkles,
};
export const DOCUMENT_ICON = LucideScroll;

/** The kind of a timeline entry, in the active language. */
export function timelineKindLabel(item: Pick<TimelineItem, 'kind' | 'source'>): string {
  if (item.source === 'story') {
    const label = STORY_KIND_LABELS[item.kind as StoryKind];
    return label ? t(label) : t('Story');
  }
  const label = EVENT_KIND_LABELS[item.kind as EventKind];
  return label ? t(label) : t('Event');
}
