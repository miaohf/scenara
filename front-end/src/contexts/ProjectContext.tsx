import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { SeriesProject, Series, Episode, Character, Scene, Prop, EpisodeCharacterRef, EpisodeSceneRef, EpisodePropRef, ProjectState } from '@/types';
import {
  loadSeriesProject, saveSeriesProject,
  getSeriesByProject, saveSeries, createNewSeries, deleteSeries as deleteSeriesFromDB,
  getEpisodesByProject, getEpisodesBySeries, saveEpisode, loadEpisode, createNewEpisode, deleteEpisode as deleteEpisodeFromDB,
} from '@/services/storageService';
import { syncCharacter, syncScene, syncProp } from '@/services/characterSyncService';

interface ProjectContextValue {
  project: SeriesProject | null;
  loading: boolean;
  allSeries: Series[];
  allEpisodes: Episode[];
  currentEpisode: Episode | null;

  reloadProject: () => Promise<void>;
  updateProject: (updates: Partial<SeriesProject>) => void;

  addCharacterToLibrary: (character: Character) => void;
  updateCharacterInLibrary: (character: Character) => void;
  removeCharacterFromLibrary: (characterId: string) => void;
  addSceneToLibrary: (scene: Scene) => void;
  updateSceneInLibrary: (scene: Scene) => void;
  removeSceneFromLibrary: (sceneId: string) => void;
  addPropToLibrary: (prop: Prop) => void;
  updatePropInLibrary: (prop: Prop) => void;
  removePropFromLibrary: (propId: string) => void;

  createSeries: (title: string) => Promise<Series>;
  updateSeries: (id: string, updates: Partial<Series>) => Promise<void>;
  removeSeries: (id: string) => Promise<void>;

  setCurrentEpisode: (episode: Episode | null) => void;
  updateEpisode: (updates: Partial<Episode> | ((prev: Episode) => Episode)) => void;
  createEpisode: (seriesId: string, title: string) => Promise<Episode>;
  removeEpisode: (id: string) => Promise<void>;
  getEpisodesForSeries: (seriesId: string) => Episode[];

  syncCharacterToEpisode: (characterId: string) => void;
  syncAllCharactersToEpisode: () => void;
  getOutdatedCharacters: () => EpisodeCharacterRef[];
  syncSceneToEpisode: (sceneId: string) => void;
  syncAllScenesToEpisode: () => void;
  getOutdatedScenes: () => EpisodeSceneRef[];
  syncPropToEpisode: (propId: string) => void;
  syncAllPropsToEpisode: () => void;
  getOutdatedProps: () => EpisodePropRef[];
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const upsertByKey = <T,>(items: T[], key: string, getKey: (item: T) => string, nextItem: T): T[] => {
  const hasItem = items.some(item => getKey(item) === key);
  if (!hasItem) return [...items, nextItem];
  return items.map(item => (getKey(item) === key ? nextItem : item));
};

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}

export function ProjectProvider({ children, projectId }: { children: React.ReactNode; projectId: string }) {
  const [project, setProject] = useState<SeriesProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [allSeries, setAllSeries] = useState<Series[]>([]);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);

  const reloadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const sp = await loadSeriesProject(projectId);
      setProject(sp);
      const seriesList = await getSeriesByProject(projectId);
      setAllSeries(seriesList);
      const eps = await getEpisodesByProject(projectId);
      setAllEpisodes(eps);
    } catch (e) {
      console.error('Failed to load project:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { reloadProject(); }, [reloadProject]);

  const persistProject = useCallback(async (sp: SeriesProject) => {
    setProject(sp);
    await saveSeriesProject(sp);
  }, []);

  const updateProject = useCallback((updates: Partial<SeriesProject>) => {
    setProject(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...updates, lastModified: Date.now() };
      saveSeriesProject(updated);
      return updated;
    });
  }, []);

  const updateProjectLibrary = useCallback((updater: (prev: SeriesProject) => SeriesProject) => {
    setProject(prev => {
      if (!prev) return null;
      const updated = updater(prev);
      void saveSeriesProject(updated);
      return updated;
    });
  }, []);

  const syncLinkedEpisodes = useCallback((params: {
    shouldSyncEpisode: (episode: Episode) => boolean;
    syncEpisode: (episode: Episode) => Episode;
    errorMessage: string;
  }) => {
    const { shouldSyncEpisode, syncEpisode, errorMessage } = params;

    // 列表接口不再带 payload，同步前必须拉完整剧集，避免用空数据覆盖落库。
    void (async () => {
      try {
        const syncedEpisodes: Episode[] = [];
        const nextEpisodes = [...allEpisodes];

        for (let index = 0; index < allEpisodes.length; index += 1) {
          const summary = allEpisodes[index];
          const full =
            currentEpisode?.id === summary.id
              ? currentEpisode
              : await loadEpisode(summary.id);
          if (!shouldSyncEpisode(full)) continue;

          const withTimestamp = { ...syncEpisode(full), lastModified: Date.now() };
          syncedEpisodes.push(withTimestamp);
          nextEpisodes[index] = {
            ...summary,
            title: withTimestamp.title,
            stage: withTimestamp.stage,
            lastModified: withTimestamp.lastModified,
          };
        }

        if (syncedEpisodes.length === 0) return;

        setAllEpisodes(nextEpisodes);

        const syncedCurrent = currentEpisode
          ? syncedEpisodes.find((ep) => ep.id === currentEpisode.id)
          : undefined;
        if (syncedCurrent) {
          setCurrentEpisode(syncedCurrent);
        }

        await Promise.all(syncedEpisodes.map((ep) => saveEpisode(ep)));
      } catch (e) {
        console.error(errorMessage, e);
      }
    })();
  }, [allEpisodes, currentEpisode]);

  const addCharacterToLibrary = useCallback((character: Character) => {
    updateProjectLibrary(prev => {
      const charWithVersion = { ...character, version: 1 };
      return {
        ...prev,
        characterLibrary: [...prev.characterLibrary, charWithVersion],
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const updateCharacterInLibrary = useCallback((character: Character) => {
    if (!project) return;

    const existing = project.characterLibrary.find(c => c.id === character.id);
    if (!existing) return;

    const updatedCharacter = { ...character, version: (existing.version || 0) + 1 };
    const updatedProject = {
      ...project,
      characterLibrary: project.characterLibrary.map(c => (
        c.id === character.id ? updatedCharacter : c
      )),
      lastModified: Date.now(),
    };

    setProject(updatedProject);
    void saveSeriesProject(updatedProject).catch(e => {
      console.error('Failed to save updated character library:', e);
    });

    syncLinkedEpisodes({
      shouldSyncEpisode: (episode) => {
        if (!episode.scriptData?.characters.some(c => c.libraryId === character.id)) return false;
        const ref = (episode.characterRefs || []).find(r => r.characterId === character.id);
        return ref?.syncStatus !== 'local-only';
      },
      syncEpisode: (episode) => syncCharacter(episode, updatedProject, character.id),
      errorMessage: 'Failed to persist synced character episodes:',
    });
  }, [project, syncLinkedEpisodes]);

  const removeCharacterFromLibrary = useCallback((characterId: string) => {
    updateProjectLibrary(prev => {
      return {
        ...prev,
        characterLibrary: prev.characterLibrary.filter(c => c.id !== characterId),
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const addSceneToLibrary = useCallback((scene: Scene) => {
    updateProjectLibrary(prev => {
      const sceneWithVersion = { ...scene, version: 1 };
      return {
        ...prev,
        sceneLibrary: [...prev.sceneLibrary, sceneWithVersion],
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const updateSceneInLibrary = useCallback((scene: Scene) => {
    if (!project) return;

    const existing = project.sceneLibrary.find(s => s.id === scene.id);
    if (!existing) return;

    const updatedScene = { ...scene, version: (existing.version || 0) + 1 };
    const updatedProject = {
      ...project,
      sceneLibrary: project.sceneLibrary.map(s => (
        s.id === scene.id ? updatedScene : s
      )),
      lastModified: Date.now(),
    };

    setProject(updatedProject);
    void saveSeriesProject(updatedProject).catch(e => {
      console.error('Failed to save updated scene library:', e);
    });

    syncLinkedEpisodes({
      shouldSyncEpisode: (episode) => {
        if (!episode.scriptData?.scenes.some(s => s.libraryId === scene.id)) return false;
        const ref = (episode.sceneRefs || []).find(r => r.sceneId === scene.id);
        return ref?.syncStatus !== 'local-only';
      },
      syncEpisode: (episode) => syncScene(episode, updatedProject, scene.id),
      errorMessage: 'Failed to persist synced scene episodes:',
    });
  }, [project, syncLinkedEpisodes]);

  const removeSceneFromLibrary = useCallback((sceneId: string) => {
    updateProjectLibrary(prev => {
      return {
        ...prev,
        sceneLibrary: prev.sceneLibrary.filter(s => s.id !== sceneId),
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const addPropToLibrary = useCallback((prop: Prop) => {
    updateProjectLibrary(prev => {
      const propWithVersion = { ...prop, version: 1 };
      return {
        ...prev,
        propLibrary: [...prev.propLibrary, propWithVersion],
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const updatePropInLibrary = useCallback((prop: Prop) => {
    if (!project) return;

    const existing = project.propLibrary.find(p => p.id === prop.id);
    if (!existing) return;

    const updatedProp = { ...prop, version: (existing.version || 0) + 1 };
    const updatedProject = {
      ...project,
      propLibrary: project.propLibrary.map(p => (
        p.id === prop.id ? updatedProp : p
      )),
      lastModified: Date.now(),
    };

    setProject(updatedProject);
    void saveSeriesProject(updatedProject).catch(e => {
      console.error('Failed to save updated prop library:', e);
    });

    syncLinkedEpisodes({
      shouldSyncEpisode: (episode) => {
        if (!(episode.scriptData?.props || []).some(p => p.libraryId === prop.id)) return false;
        const ref = (episode.propRefs || []).find(r => r.propId === prop.id);
        return ref?.syncStatus !== 'local-only';
      },
      syncEpisode: (episode) => syncProp(episode, updatedProject, prop.id),
      errorMessage: 'Failed to persist synced prop episodes:',
    });
  }, [project, syncLinkedEpisodes]);

  const removePropFromLibrary = useCallback((propId: string) => {
    updateProjectLibrary(prev => {
      return {
        ...prev,
        propLibrary: prev.propLibrary.filter(p => p.id !== propId),
        lastModified: Date.now(),
      };
    });
  }, [updateProjectLibrary]);

  const handleCreateSeries = useCallback(async (title: string): Promise<Series> => {
    if (!project) throw new Error('No project loaded');
    const s = createNewSeries(project.id, title, allSeries.length);
    await saveSeries(s);
    setAllSeries(prev => [...prev, s]);
    return s;
  }, [project, allSeries]);

  const handleUpdateSeries = useCallback(async (id: string, updates: Partial<Series>) => {
    const target = allSeries.find(s => s.id === id);
    if (!target) return;
    const updated = { ...target, ...updates, lastModified: Date.now() };
    await saveSeries(updated);
    setAllSeries(prev => prev.map(s => s.id === id ? updated : s));
  }, [allSeries]);

  const handleRemoveSeries = useCallback(async (id: string) => {
    await deleteSeriesFromDB(id);
    setAllSeries(prev => prev.filter(s => s.id !== id));
    setAllEpisodes(prev => prev.filter(ep => ep.seriesId !== id));
  }, []);

  const updateEpisode = useCallback((updates: Partial<Episode> | ((prev: Episode) => Episode)) => {
    setCurrentEpisode(prev => {
      if (!prev) return null;
      const updated = typeof updates === 'function' ? updates(prev) : { ...prev, ...updates };
      return updated;
    });
  }, []);

  const handleCreateEpisode = useCallback(async (seriesId: string, title: string): Promise<Episode> => {
    if (!project) throw new Error('No project loaded');
    const seriesEps = allEpisodes.filter(e => e.seriesId === seriesId);
    const ep = createNewEpisode(project.id, seriesId, seriesEps.length + 1, title);
    await saveEpisode(ep);
    setAllEpisodes(prev => [...prev, ep]);
    return ep;
  }, [project, allEpisodes]);

  const handleRemoveEpisode = useCallback(async (id: string) => {
    await deleteEpisodeFromDB(id);
    setAllEpisodes(prev => prev.filter(ep => ep.id !== id));
    if (currentEpisode?.id === id) setCurrentEpisode(null);
  }, [currentEpisode]);

  const getEpisodesForSeries = useCallback((seriesId: string): Episode[] => {
    return allEpisodes.filter(e => e.seriesId === seriesId).sort((a, b) => a.episodeNumber - b.episodeNumber);
  }, [allEpisodes]);

  const syncCharacterToEpisode = useCallback((characterId: string) => {
    if (!project || !currentEpisode?.scriptData) return;
    const libChar = project.characterLibrary.find(c => c.id === characterId);
    if (!libChar) return;

    setCurrentEpisode(prev => {
      if (!prev?.scriptData) return prev;
      const libVersion = libChar.version || 1;
      const newChars = prev.scriptData.characters.map(c =>
        c.libraryId === characterId ? { ...libChar, libraryId: characterId, libraryVersion: libVersion, id: c.id, variations: c.variations } : c
      );
      const nextRef = { characterId, syncedVersion: libVersion, syncStatus: 'synced' as const };
      const newRefs = upsertByKey(prev.characterRefs || [], characterId, r => r.characterId, nextRef);
      return { ...prev, scriptData: { ...prev.scriptData, characters: newChars }, characterRefs: newRefs };
    });
  }, [project, currentEpisode]);

  const syncAllCharactersToEpisode = useCallback(() => {
    const outdated = getOutdatedCharacters();
    outdated.forEach(ref => syncCharacterToEpisode(ref.characterId));
  }, [syncCharacterToEpisode]);

  const getOutdatedCharacters = useCallback((): EpisodeCharacterRef[] => {
    if (!project || !currentEpisode) return [];
    return (currentEpisode.characterRefs || []).filter(ref => {
      if (ref.syncStatus === 'local-only') return false;
      const libChar = project.characterLibrary.find(c => c.id === ref.characterId);
      return libChar && (libChar.version || 1) > ref.syncedVersion;
    });
  }, [project, currentEpisode]);

  const syncSceneToEpisode = useCallback((sceneId: string) => {
    if (!project || !currentEpisode?.scriptData) return;
    const libScene = project.sceneLibrary.find(s => s.id === sceneId);
    if (!libScene) return;

    setCurrentEpisode(prev => {
      if (!prev?.scriptData) return prev;
      const libVersion = libScene.version || 1;
      const newScenes = prev.scriptData.scenes.map(s =>
        s.libraryId === sceneId ? { ...libScene, id: s.id, libraryId: sceneId, libraryVersion: libVersion } : s
      );
      const nextRef = { sceneId, syncedVersion: libVersion, syncStatus: 'synced' as const };
      const newRefs = upsertByKey(prev.sceneRefs || [], sceneId, r => r.sceneId, nextRef);
      return { ...prev, scriptData: { ...prev.scriptData, scenes: newScenes }, sceneRefs: newRefs };
    });
  }, [project, currentEpisode]);

  const syncAllScenesToEpisode = useCallback(() => {
    const outdated = getOutdatedScenes();
    outdated.forEach(ref => syncSceneToEpisode(ref.sceneId));
  }, [syncSceneToEpisode]);

  const getOutdatedScenes = useCallback((): EpisodeSceneRef[] => {
    if (!project || !currentEpisode) return [];
    return (currentEpisode.sceneRefs || []).filter(ref => {
      if (ref.syncStatus === 'local-only') return false;
      const libScene = project.sceneLibrary.find(s => s.id === ref.sceneId);
      return libScene && (libScene.version || 1) > ref.syncedVersion;
    });
  }, [project, currentEpisode]);

  const syncPropToEpisode = useCallback((propId: string) => {
    if (!project || !currentEpisode?.scriptData) return;
    const libProp = project.propLibrary.find(p => p.id === propId);
    if (!libProp) return;

    setCurrentEpisode(prev => {
      if (!prev?.scriptData) return prev;
      const libVersion = libProp.version || 1;
      const newProps = (prev.scriptData.props || []).map(p =>
        p.libraryId === propId ? { ...libProp, id: p.id, libraryId: propId, libraryVersion: libVersion } : p
      );
      const nextRef = { propId, syncedVersion: libVersion, syncStatus: 'synced' as const };
      const newRefs = upsertByKey(prev.propRefs || [], propId, r => r.propId, nextRef);
      return { ...prev, scriptData: { ...prev.scriptData, props: newProps }, propRefs: newRefs };
    });
  }, [project, currentEpisode]);

  const syncAllPropsToEpisode = useCallback(() => {
    const outdated = getOutdatedProps();
    outdated.forEach(ref => syncPropToEpisode(ref.propId));
  }, [syncPropToEpisode]);

  const getOutdatedProps = useCallback((): EpisodePropRef[] => {
    if (!project || !currentEpisode) return [];
    return (currentEpisode.propRefs || []).filter(ref => {
      if (ref.syncStatus === 'local-only') return false;
      const libProp = project.propLibrary.find(p => p.id === ref.propId);
      return libProp && (libProp.version || 1) > ref.syncedVersion;
    });
  }, [project, currentEpisode]);

  const value: ProjectContextValue = {
    project, loading, allSeries, allEpisodes, currentEpisode,
    reloadProject, updateProject,
    addCharacterToLibrary, updateCharacterInLibrary, removeCharacterFromLibrary,
    addSceneToLibrary, updateSceneInLibrary, removeSceneFromLibrary,
    addPropToLibrary, updatePropInLibrary, removePropFromLibrary,
    createSeries: handleCreateSeries, updateSeries: handleUpdateSeries, removeSeries: handleRemoveSeries,
    setCurrentEpisode, updateEpisode,
    createEpisode: handleCreateEpisode, removeEpisode: handleRemoveEpisode,
    getEpisodesForSeries,
    syncCharacterToEpisode, syncAllCharactersToEpisode, getOutdatedCharacters,
    syncSceneToEpisode, syncAllScenesToEpisode, getOutdatedScenes,
    syncPropToEpisode, syncAllPropsToEpisode, getOutdatedProps,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
