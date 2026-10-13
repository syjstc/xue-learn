import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {ImageBoard} from '../film/image-board.js';
import {LottieExplainer} from '../film/lottie-explainer.js';
import {createAnimatedDisplay} from './animated.js';
const module:DisplayPluginModule<DisplayRenderer>={components:{
 'media:image@1':createAnimatedDisplay('image.v1',({component,...context})=><ImageBoard key={component.props.src} props={component.props} {...context}/>),
 'media:lottie@1':createAnimatedDisplay('lottie-explainer.v1',({component,motion})=><LottieExplainer props={component.props} motion={motion}/>),
}};export default module;
