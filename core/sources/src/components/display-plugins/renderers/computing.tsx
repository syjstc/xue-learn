import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {CodeBoard} from '../film/code-board.js';
import {EvaluationLab} from '../film/evaluation-lab.js';
import {createAnimatedDisplay} from './animated.js';
const module:DisplayPluginModule<DisplayRenderer>={components:{
 'computing:code@1':createAnimatedDisplay('code.v1',({component,motion})=><CodeBoard props={component.props} motion={motion}/>),
 'computing:evaluation-lab@1':createAnimatedDisplay('evaluation-lab.v1',({component,...context})=><EvaluationLab props={component.props} {...context}/>),
}};export default module;
