import React from 'react';
import type {RemotionConceptNetworkComponent, RemotionProcessComponent, RemotionTitleComponent, RemotionCardsComponent, RemotionCompareComponent} from './types.js';
import type {LessonMotion} from './lesson-motion.js';
import {ConceptCards} from './concept-cards.js';
import {GlassTitle, GlassCompare} from './glass-title-compare.js';
import {GlassProcess} from './glass-process.js';
import {GlassNetwork} from './glass-network.js';
import {GlassFit} from './glass-scene.js';

export function GeneralBoard({component, motion}: {
  component: RemotionConceptNetworkComponent | RemotionProcessComponent | RemotionTitleComponent | RemotionCardsComponent | RemotionCompareComponent;
  motion: LessonMotion;
}) {
  switch (component.type) {
    case 'cards.v1': return <ConceptCards props={component.props} motion={motion}/>;
    case 'title.v1': return <GlassFit><GlassTitle props={component.props} motion={motion}/></GlassFit>;
    case 'compare.v1': return <GlassFit><GlassCompare props={component.props} motion={motion}/></GlassFit>;
    case 'process.v1': return <GlassProcess props={component.props} motion={motion}/>;
    case 'concept-network.v1': return <GlassNetwork props={component.props} motion={motion}/>;
  }
}
