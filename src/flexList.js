import React, {Component} from 'react';
import PropTypes from "prop-types";
import ReactPaginate from 'react-paginate';
import SearchForm from './components/searchForm';
import ListContainer from './components/listContainer';
import {QuerySearch} from './ulits/querySearch';
import Utility from './ulits/utility';

class CallbackHelper {
    callback = (func) => {
        return typeof func === 'function' ? func() : '';
    };
}

const SearchFormSettings = {
    searchOnChange: false
};

const itemCallbackHelper = new CallbackHelper();

class FlexList extends Component {
    static SHOW_ALL_FILTERS_OPTIONS = 1;
    static HIDE_UNUSED_FILTERS_OPTIONS = 2;
    static DISABLE_UNUSED_FILTERS_OPTIONS = 3;

    constructor(props) {
        super(props);
        this.resolvedFiltersMapping = this._resolveFilterMapping();
        this._dynamicUpdateFilters = {};
        this.listData = this._preProcess();
        this.toBeUpdatedFilters = {};
        this._fullListPageCount = Math.ceil(this.props.listData.length / this.props.pageSize);
        this.state = {
            currentListData: this.listData,
            resultsCount: this.listData.length,
            pageCount: this._fullListPageCount,
            currentPage: 0,
            initialSearch: this.props.initialSearch
        }
    }

    componentDidMount() {
        if(this.state.initialSearch) {
            this.searchForm._submitSearchingData({
                formData: this.state.initialSearch
            });

            this.setState({
                initialSearch: null
            });
        }
    }

    _preProcess = () => {
        const {listData, listDataItemPreprocessor, filtersVisibilityOnSearch} = this.props;
        const {schema} = this.props.searchForm;
        let formFilters = {},
            processors = [],
            shouldAddCallbackInProcessors = false;

        if (!Utility.isEmpty(schema)) {
            const {_q, ...configuredFilters} = schema.properties;
            formFilters = configuredFilters;
        }

        if (!Utility.isEmpty(listDataItemPreprocessor)) {
            processors.push(listDataItemPreprocessor);
        }

        for (let filterKey in formFilters) {
            if (filtersVisibilityOnSearch.hasOwnProperty(filterKey) && parseInt(filtersVisibilityOnSearch[filterKey]) > FlexList.SHOW_ALL_FILTERS_OPTIONS) {
                shouldAddCallbackInProcessors = true;
                this._dynamicUpdateFilters[filterKey] = new Set();
            }
        }

        if (shouldAddCallbackInProcessors) {
            processors.push((listItem) => {
                listItem._updateFilterDataOnSearch = this._updateFilterDataOnSearch;
                listItem._callback = itemCallbackHelper;
            });
        }

        if (processors.length) {
            for (let item of listData) {
                for (let processor of processors) {
                    processor(item);
                }
            }
        }

        return listData;
    };

    _resolveFilterMapping = () => {
        const {filtersFieldsMap} = this.props;
        let mapping = {};
        for (let filterName in filtersFieldsMap) {
            if (typeof filtersFieldsMap[filterName] === 'string') {
                mapping[filterName] = filtersFieldsMap[filterName];
            } else {
                mapping[filterName] = Utility.isEmpty(filtersFieldsMap[filterName].name) ? filterName : filtersFieldsMap[filterName].name;
            }
        }

        return mapping;
    };

    // @todo condition of item field is object
    _updateFilterDataOnSearch = (filterKey, itemFiledData) => {
        if (Array.isArray(itemFiledData)) {
            for (let value of itemFiledData) {
                this.toBeUpdatedFilters[filterKey].add(value);
            }
        } else if (typeof itemFiledData === 'string' || typeof itemFiledData === 'number') {
            this.toBeUpdatedFilters[filterKey].add(itemFiledData);
        }

        return itemFiledData;
    };

    _buildFilterCondition = (key, value) => {
        const {filtersFieldsMap} = this.props;
        if (typeof value === 'string') {
            value = '"' + value + '"';
        }

        if (filtersFieldsMap.hasOwnProperty(key) && filtersFieldsMap[key] instanceof Object && filtersFieldsMap[key].hasMultiValues) {
            return value + ' = ANY (' + key + ')';
        }

        if (!this.resolvedFiltersMapping.hasOwnProperty(key)) {
            this.resolvedFiltersMapping[key] = key;
        }

        return (this.resolvedFiltersMapping[key] + ' = ' + value);
    };

    _handleResetAction = () => {
        this.setState({
            currentListData: this.listData,
            resultsCount: this.listData.length,
            pageCount: this._fullListPageCount,
            currentPage: 0
        });

        return {
            operation: SearchForm.RESET_FORM_CONFIGURATION
        };
    };

    _handleSearch = (formData, changedFormFields) => {
        let results,
            resetAll = true,
            searchKeywords = '',
            queryKeywordsConditions = '',
            queryFiltersConditions = [],
            querySorting = [],
            resultsPageCount,
            messageToSearchForm;

        this.toBeUpdatedFilters = {};
        for(let filterKey in this._dynamicUpdateFilters) {
            this.toBeUpdatedFilters[filterKey] = new Set();
        }

        if(typeof this.props.beforeSearch === 'function') {
            this.props.beforeSearch(formData, changedFormFields);
        }

        const {_q, _sorting, ...filters} = formData;

        if (_q !== '') {
            resetAll = false;
            searchKeywords = _q.split(' ').map((keyword) => keyword.trim());
            queryKeywordsConditions = this.props.searchTextFields.map((field) => searchKeywords.map(
                (searchKeyword) => `${field} LIKE "%${searchKeyword}%"`).join(' OR ')).join(' OR ');
        }

        for (let filterKey in filters) {
            if (!Utility.isEmpty(filters[filterKey])) {
                resetAll = false;
                queryFiltersConditions.push(this._buildFilterCondition(filterKey, filters[filterKey]));
            }
        }

        if (!Utility.isEmpty(_sorting) && typeof _sorting === 'object') {
            for (let fieldKey in _sorting) {
                querySorting.push(fieldKey + ' ' + _sorting[fieldKey]);
            }
        }

        if (resetAll) {
            return this._handleResetAction();
        }

        let queryWhere = queryFiltersConditions.join(' AND '),
            selection = '*',
            filtersVisibilityConfig = {};

        for (let filterKey in this.toBeUpdatedFilters) {
            let propertyFieldName = this.resolvedFiltersMapping.hasOwnProperty(filterKey) ?
                this.resolvedFiltersMapping[filterKey] : filterKey;

            selection += (`, _callback->callback(_updateFilterDataOnSearch->bind("", "${filterKey}", ${propertyFieldName}))`);
            filtersVisibilityConfig[filterKey] =
                this.props.filtersVisibilityOnSearch[filterKey] === FlexList.HIDE_UNUSED_FILTERS_OPTIONS ?
                    SearchForm.HIDE_UNUSED_OPTION : SearchForm.DISABLE_UNUSED_OPTION
        }

        if (searchKeywords.length) {
            queryWhere = queryWhere + (queryWhere.length ? ' AND ' : '') + '(' + queryKeywordsConditions + ')';
        }

        results = new QuerySearch()
            .select(selection)
            .from(this.listData)
            .where(queryWhere)
            .sort(querySorting.join(','))
            .execute();
        resultsPageCount = Math.ceil(results.length / this.props.pageSize);

        messageToSearchForm = {
            operation: selection.length > 1 ? SearchForm.UPDATE_FORM_CONFIGURATION : SearchForm.NOTHING_TO_CHANGE,
            filtersData: this.toBeUpdatedFilters,
            filtersVisibility: filtersVisibilityConfig
        };

        if(typeof this.props.afterSearch === 'function') {
            results = this.props.afterSearch(formData, changedFormFields, results);
        }

        this.setState({
            currentListData: results,
            resultsCount: results.length,
            pageCount: resultsPageCount,
            currentPage: 0
        });

        return messageToSearchForm;
    };

    _handlePageClick = ({selected}) => {
        this.setState({currentPage: selected});
    };

    _renderSearchForm = () => {
        if (this.props.searchForm.disable) {
            return '';
        }

        const searchFormProps = {
            ...SearchFormSettings,
            ...this.props.searchForm,
            onSearch: this._handleSearch,
            ref: (searchForm) => {this.searchForm = searchForm;}
        };

        return <SearchForm {...searchFormProps} />;
    };

    _renderPagination = () => {
        if (this.state.pageCount > 1) {
            const {className, ...paginationSettings} = this.props.paginationSettings;
            let paginationProps = {
                ...paginationSettings,
                pageCount: this.state.pageCount,
                onPageChange: this._handlePageClick
            };
            if(this.state.currentPage === 0) {
                paginationProps.forcePage = this.state.currentPage;
            }
            return <nav className={className}>
                <ReactPaginate {...paginationProps}/>
            </nav>;
        } else {
            return '';
        }
    };

    _renderResultsCount = () => {
        console.log(this.props.resultsCount);
    };

    reset = () => {
        this._handleResetAction();
        if(this.searchForm) {
            this.searchForm.resetForm();
        }
    };

    render() {
        const {
            listData,
            listDataItemPreprocessor,
            renderItem,
            searchForm,
            searchTextFields,
            filtersFieldsMap,
            filtersVisibilityOnSearch,
            pageSize,
            paginationSettings,
            listContainerSettings,
            onListRender,
            beforeSearch,
            afterSearch,
            initialSearch,
            resultsCountRender,
            ...containerProps} = this.props;
        const {currentListData, resultsCount, currentPage} = this.state;
        return (
            <div {...containerProps}>
                {this._renderSearchForm()}
                <ListContainer
                    data={currentListData.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}
                    renderItem={renderItem}
                    onListRender={onListRender}
                    {...listContainerSettings}
                />
                {resultsCountRender ? resultsCountRender({dataValue: resultsCount}) : ''}
                {this._renderPagination()}
            </div>
        );
    }
}

FlexList.defaultProps = {
    searchForm: SearchFormSettings,
    searchTextFields: [],
    filtersFieldsMap: [],
    filtersVisibilityOnSearch: {},
    listContainerSettings: {},
    pageSize: 10,
    paginationSettings: {}
};

FlexList.propsTypes = {
    listData: PropTypes.array,
    listDataItemPreprocessor: PropTypes.func,
    searchTextFields: PropTypes.array,
    filtersFieldsMap: PropTypes.array,
    filtersVisibilityOnSearch: PropTypes.object,
    searchForm: PropTypes.object,
    listContainerSettings: PropTypes.object,
    pageSize: PropTypes.number,
    paginationSettings: PropTypes.object,
    onListRender: PropTypes.func,
    renderItem: PropTypes.func,
    beforeSearch: PropTypes.func,
    afterSearch: PropTypes.func,
    initialSearch: PropTypes.object,
    resultsCountRender: PropTypes.func
};

export default FlexList
