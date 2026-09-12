import React, { useMemo, useState } from 'react';
import { Search, Film, Users, MapPin, Package, SlidersHorizontal, X, BookOpen } from 'lucide-react';
import { ProjectState, PromptVersion } from '../../types';
import { PromptCategory, EditingPrompt } from './constants';
import { 
  savePromptEdit, 
  rollbackPromptEdit,
  getPromptVersionsForEdit,
  filterCharacters, 
  filterScenes, 
  filterProps,
  filterShots 
} from './utils';
import CharacterSection from './CharacterSection';
import SceneSection from './SceneSection';
import PropSection from './PropSection';
import KeyframeSection from './KeyframeSection';
import TemplateSection from './TemplateSection';
import {
  PromptTemplatePath,
  resolvePromptTemplateConfig,
  searchPromptTemplateFields,
} from '../../services/promptTemplateService';
import BilingualLabel from '../BilingualLabel';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import ProductionBibleSection from './ProductionBibleSection';
import { resolveProductionBible } from '../../services/productionBibleService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

type SectionKey = 'bible' | 'templates' | 'characters' | 'scenes' | 'props' | 'shots';

const SECTION_KEYS: SectionKey[] = ['bible', 'templates', 'characters', 'scenes', 'props', 'shots'];

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  all: '全部',
  bible: '项目圣经',
  templates: '模板',
  characters: '角色',
  scenes: '场景',
  props: '道具',
  keyframes: '关键帧',
};

const CATEGORY_LABELS_EN: Record<PromptCategory, string> = {
  all: 'All',
  bible: 'Bible',
  templates: 'Templates',
  characters: 'Characters',
  scenes: 'Locations',
  props: 'Props',
  keyframes: 'Keyframes',
};

const StagePrompts: React.FC<Props> = ({ project, updateProject }) => {
  const { text } = useInterfaceLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<PromptCategory>('all');
  const [editingPrompt, setEditingPrompt] = useState<EditingPrompt>(null);
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set<SectionKey>(SECTION_KEYS)
  );
  const templateConfig = useMemo(
    () => resolvePromptTemplateConfig(project.promptTemplateOverrides),
    [project.promptTemplateOverrides]
  );

  const toggleSection = (section: SectionKey) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleStartEdit = (
    type: 'character' | 'character-variation' | 'scene' | 'prop' | 'keyframe' | 'video',
    id: string,
    currentValue: string,
    variationId?: string,
    shotId?: string
  ) => {
    setEditingPrompt({ type, id, value: currentValue, variationId, shotId });
  };

  const handleSaveEdit = () => {
    if (!editingPrompt) return;

    updateProject((prev: ProjectState) => savePromptEdit(prev, editingPrompt));
    setEditingPrompt(null);
  };

  const handleCancelEdit = () => {
    setEditingPrompt(null);
  };

  const handlePromptChange = (value: string) => {
    if (editingPrompt) {
      setEditingPrompt({ ...editingPrompt, value });
    }
  };

  const editingVersions: PromptVersion[] = getPromptVersionsForEdit(project, editingPrompt);

  const handleRollbackVersion = (versionId: string) => {
    if (!editingPrompt) return;
    const { project: nextProject, restoredPrompt } = rollbackPromptEdit(
      project,
      {
        type: editingPrompt.type,
        id: editingPrompt.id,
        variationId: editingPrompt.variationId,
        shotId: editingPrompt.shotId,
      },
      versionId
    );
    if (!restoredPrompt) return;
    updateProject(nextProject);
    setEditingPrompt({ ...editingPrompt, value: restoredPrompt });
  };

  const setAllSectionsExpanded = (expanded: boolean) => {
    setExpandedSections(expanded ? new Set<SectionKey>(SECTION_KEYS) : new Set<SectionKey>());
  };

  // Search first, then apply category filter
  const searchedTemplateFields = useMemo(
    () => searchPromptTemplateFields(templateConfig, searchQuery),
    [templateConfig, searchQuery]
  );
  const searchedCharacters = filterCharacters(project.scriptData?.characters || [], searchQuery);
  const searchedScenes = filterScenes(project.scriptData?.scenes || [], searchQuery);
  const searchedProps = filterProps(project.scriptData?.props || [], searchQuery);
  const searchedShots = filterShots(project.shots || [], searchQuery);
  const resolvedBible = resolveProductionBible(project.scriptData);
  const bibleText = Object.values(resolvedBible)
    .flatMap((value) => Array.isArray(value) ? value : [String(value || '')])
    .join('\n')
    .toLowerCase();
  const bibleMatchesSearch = !searchQuery.trim() || bibleText.includes(searchQuery.trim().toLowerCase());

  const filteredTemplateFields = category === 'all' || category === 'templates'
    ? searchedTemplateFields
    : [];

  const filteredCharacters = category === 'all' || category === 'characters'
    ? searchedCharacters
    : [];

  const filteredScenes = category === 'all' || category === 'scenes'
    ? searchedScenes
    : [];

  const filteredProps = category === 'all' || category === 'props'
    ? searchedProps
    : [];

  const filteredShots = category === 'all' || category === 'keyframes'
    ? searchedShots
    : [];
  const filteredBibleCount = project.scriptData && (category === 'all' || category === 'bible') && bibleMatchesSearch ? 7 : 0;

  const totalCharacters = project.scriptData?.characters.length || 0;
  const totalScenes = project.scriptData?.scenes.length || 0;
  const totalProps = project.scriptData?.props.length || 0;
  const totalShots = project.shots.length || 0;
  const totalTemplates = searchPromptTemplateFields(templateConfig, '').length;
  const totalBibleItems = project.scriptData ? 7 : 0;
  const totalItems = totalBibleItems + totalTemplates + totalCharacters + totalScenes + totalProps + totalShots;
  const visibleItems =
    filteredBibleCount +
    filteredTemplateFields.length +
    filteredCharacters.length +
    filteredScenes.length +
    filteredProps.length +
    filteredShots.length;
  const hasNoData = totalItems === 0;
  const hasFilteredResults = visibleItems > 0;

  const sectionSummary = [
    {
      key: 'bible' as const,
      category: 'bible' as const,
      label: '项目圣经',
      icon: <BookOpen className="w-4 h-4" />,
      total: totalBibleItems,
      filtered: bibleMatchesSearch ? totalBibleItems : 0,
    },
    {
      key: 'templates' as const,
      category: 'templates' as const,
      label: '模板',
      icon: <SlidersHorizontal className="w-4 h-4" />,
      total: totalTemplates,
      filtered: searchedTemplateFields.length,
    },
    {
      key: 'characters' as const,
      category: 'characters' as const,
      label: '角色',
      icon: <Users className="w-4 h-4" />,
      total: totalCharacters,
      filtered: searchedCharacters.length
    },
    {
      key: 'scenes' as const,
      category: 'scenes' as const,
      label: '场景',
      icon: <MapPin className="w-4 h-4" />,
      total: totalScenes,
      filtered: searchedScenes.length
    },
    {
      key: 'props' as const,
      category: 'props' as const,
      label: '道具',
      icon: <Package className="w-4 h-4" />,
      total: totalProps,
      filtered: searchedProps.length
    },
    {
      key: 'shots' as const,
      category: 'keyframes' as const,
      label: '关键帧',
      icon: <Film className="w-4 h-4" />,
      total: totalShots,
      filtered: searchedShots.length
    }
  ];

  const categoryOptions: PromptCategory[] = ['all', 'bible', 'templates', 'characters', 'scenes', 'props', 'keyframes'];
  const editingCategoryLabel = editingPrompt
    ? (() => {
        switch (editingPrompt.type) {
          case 'character':
          case 'character-variation':
            return CATEGORY_LABELS.characters;
          case 'scene':
            return CATEGORY_LABELS.scenes;
          case 'prop':
            return CATEGORY_LABELS.props;
          case 'keyframe':
          case 'video':
            return CATEGORY_LABELS.keyframes;
          default:
            return CATEGORY_LABELS.all;
        }
      })()
    : null;

  return (
    <div className="h-full bg-[var(--bg-secondary)] flex flex-col">
      {/* Header */}
      <div className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
                <BilingualLabel primary="提示词库" secondary="PROMPT LIBRARY" mode="stacked" />
              </h1>
              <p className="text-sm text-[var(--text-tertiary)]">{text('统一管理角色、场景、道具、关键帧与视频提示词', 'Review, search and edit production prompts')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-secondary)] font-mono">
                {text('总条目', 'TOTAL')} {totalItems}
              </span>
              <span className="text-xs px-3 py-1.5 rounded-full bg-[var(--accent-bg)] border border-[var(--accent-border)] text-[var(--accent-text)] font-mono">
                {text('当前结果', 'RESULTS')} {visibleItems}
              </span>
              {editingPrompt && (
                <span className="text-xs px-3 py-1.5 rounded-full bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-text)]">
                  {text('正在编辑', 'EDITING')}: {text(editingCategoryLabel || '', editingPrompt.type === 'scene' ? 'Locations' : editingPrompt.type === 'prop' ? 'Props' : editingPrompt.type === 'keyframe' || editingPrompt.type === 'video' ? 'Keyframes' : 'Characters')}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {sectionSummary.map((item) => {
              const isActive = category === 'all' || category === item.category;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.category)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    isActive
                      ? 'bg-[var(--accent-bg)] border-[var(--accent-border)]'
                      : 'bg-[var(--bg-elevated)] border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-1">
                    {item.icon}
                    <span className="text-sm font-semibold">{text(item.label, CATEGORY_LABELS_EN[item.category])}</span>
                  </div>
                  <div className="text-xs font-mono text-[var(--text-tertiary)]">
                    {item.filtered} / {item.total}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Search and Filter */}
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={text('搜索提示词、角色、场景、动作...', 'Search prompts, characters, locations, or actions...')}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] pl-10 pr-10 py-2 rounded-lg text-sm focus:border-[var(--accent)] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  title={text('清空搜索', 'Clear search')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    category === option
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-on)]'
                      : 'bg-[var(--bg-elevated)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]'
                  }`}
                >
                  {text(CATEGORY_LABELS[option], CATEGORY_LABELS_EN[option])}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 xl:ml-auto">
              <button
                type="button"
                onClick={() => setAllSectionsExpanded(true)}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
              >
                {text('全部展开', 'Expand All')}
              </button>
              <button
                type="button"
                onClick={() => setAllSectionsExpanded(false)}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
              >
                {text('全部收起', 'Collapse All')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          {project.scriptData && filteredBibleCount > 0 && (
            <ProductionBibleSection
              key={project.scriptData.productionBible?.updatedAt || 'derived'}
              scriptData={project.scriptData}
              isExpanded={expandedSections.has('bible')}
              onToggle={() => toggleSection('bible')}
              onUpdate={(productionBible) => updateProject((prev) => prev.scriptData ? ({
                ...prev,
                scriptData: { ...prev.scriptData, productionBible },
              }) : prev)}
            />
          )}

          {(category === 'all' || category === 'templates') && (
            <TemplateSection
              templateConfig={templateConfig}
              templateOverrides={project.promptTemplateOverrides}
              visiblePaths={new Set<PromptTemplatePath>(filteredTemplateFields.map((field) => field.path))}
              isExpanded={expandedSections.has('templates')}
              onToggle={() => toggleSection('templates')}
              onUpdateOverrides={(nextOverrides) => updateProject({ promptTemplateOverrides: nextOverrides })}
            />
          )}

          {project.scriptData && (
            <>
              <CharacterSection
                characters={filteredCharacters}
                isExpanded={expandedSections.has('characters')}
                onToggle={() => toggleSection('characters')}
                editingPrompt={editingPrompt}
                editingVersions={editingVersions}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onPromptChange={handlePromptChange}
                onRollbackVersion={handleRollbackVersion}
              />

              <SceneSection
                scenes={filteredScenes}
                isExpanded={expandedSections.has('scenes')}
                onToggle={() => toggleSection('scenes')}
                editingPrompt={editingPrompt}
                editingVersions={editingVersions}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onPromptChange={handlePromptChange}
                onRollbackVersion={handleRollbackVersion}
              />

              <PropSection
                props={filteredProps}
                isExpanded={expandedSections.has('props')}
                onToggle={() => toggleSection('props')}
                editingPrompt={editingPrompt}
                editingVersions={editingVersions}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onPromptChange={handlePromptChange}
                onRollbackVersion={handleRollbackVersion}
              />
            </>
          )}

          {project.shots.length > 0 && (
            <KeyframeSection
              shots={filteredShots}
              scriptData={project.scriptData}
              isExpanded={expandedSections.has('shots')}
              onToggle={() => toggleSection('shots')}
              editingPrompt={editingPrompt}
              editingVersions={editingVersions}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onPromptChange={handlePromptChange}
              onRollbackVersion={handleRollbackVersion}
            />
          )}

          {/* No Filter Results */}
          {!hasNoData && !hasFilteredResults && (
            <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-8 text-center">
              <p className="text-base text-[var(--text-secondary)] mb-2">{text('当前筛选条件下没有可显示的提示词', 'No prompts match the current filters')}</p>
              <p className="text-sm text-[var(--text-tertiary)] mb-4">
                {text('你可以调整分类或清空搜索关键字后重试', 'Change the category or clear the search to try again.')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {!!searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-base)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
                  >
                    {text('清空搜索', 'Clear Search')}
                  </button>
                )}
                {category !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setCategory('all')}
                    className="text-xs px-3 py-1.5 rounded-md bg-[var(--accent)] border border-[var(--accent)] text-[var(--accent-on)]"
                  >
                    {text('查看全部分类', 'View All Categories')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Empty State */}
          {hasNoData && (
            <div className="text-center py-16 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)]">
              <div className="text-[var(--text-muted)] mb-4">
                <Film className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">{text('暂无提示词数据', 'No prompt data yet')}</p>
                <p className="text-sm mt-2">{text('请先在剧本阶段生成角色和场景，或在导演工作台生成分镜', 'Generate characters and locations in Story Planning, or create shots in Shot Design first.')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StagePrompts;
