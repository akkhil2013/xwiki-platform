var XWiki = (function (XWiki) {
// Start XWiki augmentation.
/**
 * Enhances the behaviour of an extension.
 */
XWiki.ExtensionBehaviour = Class.create({
  initialize : function (container) {
    // Make sure the extension is not already initialized.
    this.finalize();

    this.container = container;
    this.container._extensionBehaviour = this;

    // The extension links (links to extension dependencies, links inside log messages) use the 'get' action when
    // extension details are loaded asynchronously so we need to replace it with 'view' or 'admin' action, depending
    // whether the extension is displayed alone or in the administration.
    this._fixExtensionLinks();

    // Trigger the extension jobs asynchronously.
    this._enhanceActions();

    // Enhances the behaviour of the extension details menu (Description/Dependencies/Progress).
    this._enhanceMenuBehaviour();

    // Enhances the behaviour of the Description section.
    this._enhanceDescriptionBehaviour();

    // Enhances the behaviour of the Dependencies section.
    this._enhanceDependenciesBehaviour();

    // Enhances the behaviour of the Progress section.
    this._enhanceProgressBehaviour();

    // Refresh the extension display if the extension has a job running.
    this._maybeScheduleRefresh();
  },

  /**
   * Releases the event listeners and detaches the extension.
   */
  finalize : function() {
    if (this.container) {
      delete this.container._extensionBehaviour;
      this.container.remove();
    }
    this.container = undefined;
  },

  /**
   * Returns the extension namespace.
   */
  getNamespace : function() {
    var namespaceHiddenInput = this.container.down('input[name="extensionNamespace"]');
    return namespaceHiddenInput ? namespaceHiddenInput.value : null;
  },

  /**
   * Returns the extension identifier.
   */
  getId : function() {
    var idHiddenInput = this.container.down('input[name="extensionId"]');
    return idHiddenInput ? idHiddenInput.value : null;
  },

  /**
   * Returns the extension version.
   */
  getVersion : function() {
    var versionHiddenInput = this.container.down('input[name="extensionVersion"]');
    return versionHiddenInput ? versionHiddenInput.value : null;
  },

  /**
   * Returns the status of the extension (loading, core, remote, installed, etc.).
   */
  getStatus : function() {
    var classNames = $w(this.container.className);
    for (var i = 0; i < classNames.length; i++) {
      if (classNames[i].startsWith('extension-item-')) {
        return classNames[i].substr(15);
      }
    }
    return null;
  },

  /**
   * Returns the URL of the service used to retrieve extension details and to install/uninstall extensions.
   */
  _getServiceURL : function(serviceDocument) {
    if (serviceDocument) {
      serviceDocument = XWiki.getResource(serviceDocument);
      serviceDocument = new XWiki.Document(serviceDocument.name, serviceDocument.space, serviceDocument.wiki);
    } else {
      serviceDocument = XWiki.currentDocument;
    }
    var action = XWiki.contextaction == 'view' || XWiki.contextaction == 'admin' ? 'get' : XWiki.contextaction;
    return serviceDocument.getURL(action);
  },

  /**
   * Handles an AJAX request failure.
   * @return {@code true} to retry the request, {@code false} otherwise
   */
  _onAjaxRequestFailure : function(response) {
    if (response.status == 401) {
      // Unauthorized request. This can happen for instance if the session expires or if the user looses rights while
      // installing or uninstalling an extension. By reloading the page we hope the user will be redirected to the
      // login page and then, after he authenticates, back to the current page.
      new XWiki.widgets.ConfirmationBox({
        onYes: function() {
          window.location.reload(true);
        }
      }, {
        confirmationText: "$escapetool.javascript($services.localization.render('extensions.info.fetch.unauthorized'))"
      });
      return false;
    } else {
      var failureReason = response.statusText;
      if (response.statusText == '' /* No response */ || response.status == 12031 /* In IE */) {
        failureReason = 'Server not responding';
      }
      new XWiki.widgets.Notification("$escapetool.javascript($services.localization.render('extensions.info.fetch.failed'))" + failureReason, "error");
      return true;
    }
  },

  /**
   * Submit a form asynchronously.
   */
  _submit : function(event, ajaxRequestParameters) {
    event.stop();

    // Prepare the data for the AJAX call.
    var form = event.element().form;
    var formData = new Hash(form.serialize({submit: false}));
    // The extension action buttons have the same name and different values so we can't rely on Form#serialize() because
    // it looks for the first button with the given name.
    formData.set(event.element().name, event.element().value);

    // Disable the form to prevent it from being re-submitted while we wait for the response.
    form.disable();

    // Default AJAX request parameters.
    var defaultAJAXRequestParameters = {
      parameters : formData,
      onFailure : this._onAjaxRequestFailure.bind(this),
      on0 : function (response) {
        response.request.options.onFailure(response);
      },
      onComplete : function() {
        // Re-enable the form.
        form.enable();
      }
    }

    // Inject a reference to the (cloned) default AJAX request parameters to be able
    // to access the defaults even when they are overwritten by the provided values.
    defaultAJAXRequestParameters.defaultValues = Object.clone(defaultAJAXRequestParameters);

    // Launch the AJAX call.
    new Ajax.Request(this._getServiceURL(formData.get('section')), Object.extend(defaultAJAXRequestParameters, ajaxRequestParameters));
  },

  _update : function(html) {
    // Save the current state of the extension display so that it can be restored afterwards.
    var oldExtensionBody = this.container.down('.extension-body');
    var oldExtensionBodyHidden = !oldExtensionBody || oldExtensionBody.hasClassName('hidden');
    var currentMenuItem = this.container.down('.innerMenu li a.current');
    currentMenuItem && (this._previouslySelectedMenuItem = currentMenuItem.getAttribute('href'));
    var oldStatus = this.getStatus();
    // Replace the current extension container element with the one that was just fetched.
    this.container.addClassName('hidden');
    this.container.insert({after : html});
    // Attach behaviour to the new element.
    this.initialize(this.container.next());
    // Restore the state of the extension display.
    var newExtensionBody = this.container.down('.extension-body');
    var newExtensionBodyHidden = !newExtensionBody || newExtensionBody.hasClassName('hidden');
    oldExtensionBodyHidden && !newExtensionBodyHidden && this._onToggleShowHideDetails({
      stop : function() {},
      element : function() {return this.container.down('button[value="hideDetails"]')}.bind(this)
    });
    // Fire an event when the extension status changes.
    if (oldStatus != this.getStatus()) {
      document.fire('xwiki:extension:statusChanged', {extension: this});
    }
    // Notify the others that the DOM has been updated.
    document.fire('xwiki:dom:updated', {elements: [this.container]});
  },

  /**
   * Load the extension details asynchronously.
   */
  _onShowDetails : function(event) {
    // Launch the AJAX call to fetch extension details.
    this._submit(event, {
      onCreate : function() {
        // Don't panic, the content is loading.
        this.container.insert({bottom: new Element('div', {'class' : 'extension-body loading'})});
      }.bind(this),
      onSuccess : function(response) {
        this._update(response.responseText);
      }.bind(this),
      onComplete : function(response) {
        response.request.options.defaultValues.onComplete(response);
        // Remove the loading marker if it's still there (i.e. fetching failed).
        var loadingMarker = this.container.down('.extension-body.loading');
        loadingMarker && loadingMarker.remove();
      }.bind(this)
    });
  },

  /**
   * Enables the asynchronous loading of extension details and the show/hide extension details toggle.
   */
  _enhanceShowDetailsBehaviour : function() {
    var showDetailsButton = this.container.down('button[value="showDetails"]');
    if (!showDetailsButton) {
      return;
    }
    if (showDetailsButton.hasClassName('visibilityAction')) {
      // Show/hide extension details toggle.
      showDetailsButton = showDetailsButton.up();
      var hideDetailsButton = this.container.down('button[value="hideDetails"]').up();
      showDetailsButton.__otherButton = hideDetailsButton;
      hideDetailsButton.__otherButton = showDetailsButton;
      this.container.select('.visibilityAction').invoke('observe', 'click', this._onToggleShowHideDetails.bindAsEventListener(this));
      showDetailsButton.remove();
    } else {
      // Load the extension details asynchronously.
      showDetailsButton.observe('click', this._onShowDetails.bindAsEventListener(this));
    }
  },

  /**
   * Toggles the visibility of the extension details.
   */
  _onToggleShowHideDetails : function(event) {
    event.stop();
    var button = event.element().up('span');
    this.container.down('.extension-body').toggleClassName('hidden');
    button.replace(button.__otherButton);
  },

  /**
   * Trigger the extension jobs asynchronously.
   */
  _enhanceActions : function() {
    // Handle the Show/Hide Details buttons separately.
    this._enhanceShowDetailsBehaviour();
    // Handle the buttons that trigger extension jobs.
    var startJobHandler = this._startJob.bindAsEventListener(this);
    this.container.select('button[name="extensionAction"]').each(function(button) {
      if (!button.value.endsWith('Details')) {
        button.observe('click', startJobHandler);
      }
    });
  },

  /**
   * Indicate to the user that a job has been started.
   */
  _onBeforeStartJob : function() {
    // Check if the extension details have been fetched.
    var extensionBody = this.container.down('.extension-body');
    if (extensionBody) {
      // Make sure the extension details are visible.
      extensionBody.hasClassName('hidden') && this._onToggleShowHideDetails({
        stop : function() {},
        element : function() {return this.container.down('button[value="showDetails"]')}.bind(this)
      });
      // Prepare the progress section: create one if it is missing, clear its contents otherwise.
      var progressSection = this._prepareProgressSectionForLoading();
      // Activate the progress section.
      this._activateMenuItem(extensionBody.down('.innerMenu li a[href="#' + progressSection.previous().id + '"]'));
    } else {
      this.container.insert({bottom: new Element('div', {'class' : 'extension-body loading'})});
    }
  },

  /**
   * This method is called before a request related to the progress section is made. Creates an empty
   * progress section if none is found, otherwise hides its contents and displays the loading animation.
   * @see #_restoreProgressSection()
   */
  _prepareProgressSectionForLoading : function() {
    // Check if the progress section is available.
    var progressSection = this.container.down('.extension-body-progress');
    if (!progressSection) {
      // Add an empty progress section.
      var lastSection = this.container.select('.extension-body-section').last();
      progressSection = new Element('div', {'class': 'extension-body-progress extension-body-section loading'});
      lastSection.insert({after: progressSection});
      // Add the section anchor.
      var progressSectionAnchor = 'extension-body-progress' + lastSection.previous().id.substr($w(lastSection.className)[0].length);
      lastSection.insert({after: new Element('div', {id: progressSectionAnchor})});
      // Add the progress menu.
      var progressMenuLabel = "$escapetool.javascript($services.localization.render('extensions.info.category.progress'))";
      var progressMenu = new Element('a', {href: '#' + progressSectionAnchor}).update(progressMenuLabel);
      this._enhanceMenuItemBehaviour(progressMenu);
      this.container.down('.innerMenu').insert(new Element('li').insert(progressMenu));
    } else if (progressSection.down('.extension-log-item-loading')) {
      // Just hide the question that has been answered if there is any progress item loading.
      progressSection.down('.extension-question').hide();
    } else {
      // Hide all the contents of the progress section and display the loading animation.
      progressSection.childElements().invoke('hide');
      progressSection.addClassName('loading');
    }
    return progressSection;
  },

  /**
   * Removes the loading markers if the request for starting an Extension Manager job failed.
   */
  _onAfterStartJob : function(response) {
    response.request.options.defaultValues.onComplete(response);
    // Remove the loading markers if they are still present (i.e. request failed).
    var extensionBodyLoading = this.container.down('.extension-body.loading');
    if (extensionBodyLoading) {
      extensionBodyLoading.remove();
    } else {
      this._restoreProgressSection();
    }
  },

  /**
   * This method is called when a request related to the progress section fails. Removes the loading
   * animation and restores the previous contents of the progress section is they were saved.
   * @see #_prepareProgressSectionForLoading()
   */
  _restoreProgressSection : function() {
    var progressSection = this.container.down('.extension-body-progress');
    if (progressSection) {
      // Show the contents of the progress section and remove the loading animation.
      progressSection.childElements().invoke('show');
      progressSection.removeClassName('loading');
    }
  },

  /**
   * Starts an Extension Manager asynchronous job. Examples of Extension Manager jobs are: compute install plan, install.
   */
  _startJob : function(event) {
    // Launch the AJAX call to start the asynchronous job.
    this._submit(event, {
      onCreate : this._onBeforeStartJob.bind(this),
      onSuccess : function(response) {
        this._update(response.responseText);
      }.bind(this),
      onComplete : this._onAfterStartJob.bind(this)
    });
  },

  /**
   * Marks the extension as loading and redisplays it using updated information from the server.
   *
   * @param extraParams additional submit parameters
   */
  refresh : function(extraParams) {
    this.container.addClassName('extension-item-loading');
    this._refresh(extraParams);
    // Disable the action buttons while the extension display is reloaded.
    this.container.disable();
  },

  /**
   * Redisplays the extension using updated information from the server.
   *
   * @param extraParams additional submit parameters
   */
  _refresh : function(extraParams) {
    // Prepare the data for the AJAX call.
    var formData = new Hash(this.container.serialize({submit: false}));
    extraParams && formData.update(extraParams);

    // Preserve the menu selection while the extension display is refreshed.
    this._preserveMenuSelection = true;

    // Launch the AJAX call.
    new Ajax.Request(this._getServiceURL(formData.get('section')), {
      parameters : formData,
      onSuccess : function(response) {
        this._update(response.responseText);
      }.bind(this),
      onFailure : function(response) {
        if (this._onAjaxRequestFailure(response)) {
          // Use a longer refresh timeout after an AJAX request failure.
          this._maybeScheduleRefresh(10);
        }
      }.bind(this),
      on0 : function (response) {
        response.request.options.onFailure(response);
      }
    });
  },

  /**
   * Schedule a new refresh if the extension has a job running.
   */
  _maybeScheduleRefresh : function(timeout) {
    timeout = timeout || 1;
    this.container.hasClassName('extension-item-loading') && !this.container.down('button[value="continue"]') && this._refresh.bind(this).delay(timeout);
  },

  /**
   * Enhances the behaviour of the extension details menu (Description/Dependencies/Progress).
   */
  _enhanceMenuBehaviour : function() {
    var menuItemSelector = '.innerMenu li a';
    // Preserve the menu selection only when the extension display is triggered by a refresh. If the display is
    // triggered by the start of an extension job then activate the menu indicated by the server.
    var currentMenuItem = this.container.down(menuItemSelector + '.current');
    if (!currentMenuItem || this._preserveMenuSelection) {
      // Expand the previously selected menu item, if specified, to preserve the state of the extension display.
      if (this._previouslySelectedMenuItem) {
        currentMenuItem = this.container.down(menuItemSelector + '[href="' + this._previouslySelectedMenuItem + '"]');
      } else if (!currentMenuItem) {
        // Expand the first menu item.
        currentMenuItem = this.container.down(menuItemSelector);
      }
    }
    this._preserveMenuSelection = false;
    if (currentMenuItem) {
      this._activateMenuItem(currentMenuItem);
      // Make the activation of menu items persistent.
      this.container.select(menuItemSelector).each(this._enhanceMenuItemBehaviour, this);
    }
  },

  /**
   * Makes sure that menu items are activated when clicked.
   */
  _enhanceMenuItemBehaviour : function(menuItem) {
    menuItem.observe('click', function(event) {
      event.stop();
      this._activateMenuItem(event.element());
    }.bindAsEventListener(this));
  },

  _activateMenuItem : function(menuItem) {
    // Hide all sections (each section is associated with a menu item).
    this.container.select('.extension-body-section').invoke('setStyle', {'display' : 'none'});
    // Unmark the currently active menu item.
    var currentMenuItem = this.container.down('.innerMenu li a.current');
    if (currentMenuItem) {
       currentMenuItem.removeClassName('current');
    }
    // Display the section associated with the given menu item (the menu item that was clicked).
    // (the href attribute is expected be "#id-of-an-anchor-placed-before-the-section-to-display)
    $(menuItem.getAttribute('href').substring(1)).next('.extension-body-section').setStyle({'display' : 'block'});
    // Mark the given menu item as active (i.e. select the menu item that was clicked).
    menuItem.addClassName('current');
  },

  /**
   * Fix the extension links (links to extension dependencies, links inside log messages) when the extension details
   * are loaded asynchronously because they use the 'get' action (specific to AJAX requests) instead of the 'view' or
   * 'admin' action (depending whether the extension is displayed alone or in the administration section).
   */
  _fixExtensionLinks : function(container) {
    (container || this.container).select("a.extension-link").each(function (link) {
      var queryString = link.getAttribute('href').replace(/.*\?/, '');
      link.setAttribute('href', XWiki.currentDocument.getURL(XWiki.contextaction, queryString));
    });
  },

  /**
   * Enhances the behaviour of the Progress section within the extension details.
   */
  _enhanceProgressBehaviour : function() {
    // Toggle stacktrace display in extension log.
    this.container.select('.extension-log-item').each(function (logItem) {
      var stacktrace = logItem.down('.stacktrace');
      if (stacktrace) {
        // Hide the stacktrace by default.
        stacktrace.toggle();
        // Show the stacktrace when the log message is clicked.
        var logMessage = logItem.down('div');
        logMessage.setStyle({"cursor": "pointer"});
        logMessage.observe('click', function() {
          stacktrace.toggle();
        });
      }
    });
    // Scroll the progress log to the end if it has a loading item.
    // TODO: Preserve the scroll position if the user scrolls through the log.
    var loadingLogItem = this.container.down('.extension-log-item-loading');
    if (loadingLogItem) {
      var log = loadingLogItem.up();
      log.scrollTop = log.scrollHeight;
    }
  },

  /**
   * Enhances the behaviour of the Dependencies section within the extension details.
   */
  _enhanceDependenciesBehaviour : function() {
    // Don't resolve unknown dependencies while the extension has a job running.
    if (!this.container.hasClassName('extension-item-loading')) {
      this._resolveUnknownDependency(this.container.select('.dependency-item.extension-item-unknown'), 0);
    }
  },

  /**
   * Makes an AJAX request to resolve the specified dependency.
   */
  _resolveUnknownDependency : function(dependencies, index) {
    if (index >= dependencies.length) {
      return;
    }

    // Prepare the data for the AJAX call.
    var formData = new Hash(this.container.serialize({submit: false}));
    formData.unset('extensionVersion');
    formData.unset('form_token');

    var dependency = dependencies[index];
    formData.set('extensionId', dependency.down('.extension-name').innerHTML);
    formData.set('extensionVersionConstraint', dependency.down('.extension-version').innerHTML);

    new Ajax.Request(this._getServiceURL(formData.get('section')), {
      parameters : formData,
      onCreate : function() {
        dependency.removeClassName('extension-item-unknown').addClassName('extension-item-loading');
      },
      onSuccess : function(response) {
        // Update the dependency if it's still attached to the document.
        if (dependency.up('html')) {
          dependency.insert({before: response.responseText});
          this._fixExtensionLinks(dependency.previous());
          dependency.remove();
          this._resolveUnknownDependency(dependencies, index + 1);
        }
      }.bind(this),
      onFailure : function(response) {
        dependency.removeClassName('extension-item-loading').addClassName('extension-item-unknown');
        this._onAjaxRequestFailure(response);
      }.bind(this),
      on0 : function (response) {
        response.request.options.onFailure(response);
      }
    });
  },

  /**
   * Enhances the behaviour of the Description section within the extension details.
   */
  _enhanceDescriptionBehaviour : function() {
    var extensionVersionsLink = this.container.down('.extension-versions-link');
    extensionVersionsLink && extensionVersionsLink.observe('click', function(event) {
      event.stop();
      // Hide the link and show the loading annimation.
      event.element().hide().up().addClassName('loading').setStyle({'height': '16px', 'width': '16px'});
      this._refresh({'listVersions': true});
    }.bindAsEventListener(this));
  }
});


/**
 * Enhances the behaviour of the extension search form.
 */
XWiki.ExtensionSearchFormBehaviour = Class.create({
  initialize : function () {
    this._enhanceSimpleSearch();
    this._enhanceAdvancedSearch();
  },

  _enhanceSimpleSearch : function() {
    var simpleSearchBox = $('extension-search-simple');
    if (!simpleSearchBox) {
      return;
    }
    // Submit the search form whenever the user selects a different repository.
    $('extensionSearchRepositoryList').observe('change', function(event) {
      // Make sure we don't submit the search tip.
      $('extensionSearchInput').focus();
      // Defer the submit so that the search input is properly focused.
      var form = event.element().form;
      form.submit.bind(form).defer();
    }.bindAsEventListener(this));
  },

  _enhanceAdvancedSearch : function() {
    var advancedSearchBox = $('extension-search-advanced');
    if (!advancedSearchBox) {
      return;
    }
    var advancedSearchTrigger = advancedSearchBox.down('legend a');//ry :)
    if (advancedSearchTrigger) {
      var target = advancedSearchTrigger.up('legend').next().next();
      if (target) {
        advancedSearchTrigger.observe('click', function(event) {
          event.stop();
          advancedSearchTrigger.blur();
          target.toggleClassName('hidden');
          advancedSearchTrigger.toggleClassName('expanded');
        });
        var cancelTrigger = target.down('a.actionCancel');
        if (cancelTrigger) {
          cancelTrigger.observe('click', function(event) {
            event.stop();
            cancelTrigger.up('form').select('input[type=text]').each(function(input) {
              input.value = '';
            });
            advancedSearchTrigger.click();
          });
        }
      }
    }
  }
});


/**
 * Enhances the behaviour of the extension updater.
 */
XWiki.ExtensionUpdaterBehaviour = Class.create({
  initialize : function(container) {
    this.container && this.container.remove();
    this.container = container;

    var checkForUpdatesLink = this.container.down('.checkForUpdates');
    checkForUpdatesLink && checkForUpdatesLink.observe('click', this._onCheckForUpdates.bindAsEventListener(this));

    this._maybeScheduleRefresh();
  },

  _maybeScheduleRefresh : function(timeout) {
    this.container && this.container.childElements().any(function(child) {return child.hasClassName('ui-progress')})
      && this._refresh.bind(this).delay(timeout || 1);
  },

  _refresh : function(parameters) {
    parameters = parameters || {};
    new Ajax.Request(this._getRefreshURL(), {
      parameters: parameters,
      onSuccess: function(response) {
        this.container.addClassName('hidden').insert({after : response.responseText});
        this.initialize(this.container.next());
        document.fire('xwiki:dom:updated', {elements: [this.container]});
        // Scroll the progress log to the end if it has a loading item.
        // TODO: Preserve the scroll position if the user scrolls through the log.
        this.container.childElements().each(function(child) {
          if (child.hasClassName('extension-body-progress')) {
            var loadingLogItem = child.down('.extension-log-item-loading');
            if (loadingLogItem) {
              var log = loadingLogItem.up();
              log.scrollTop = log.scrollHeight;
            }
          }
        });
      }.bind(this),
      onFailure : this._maybeScheduleRefresh.bind(this, 10)
    });
  },

  _getRefreshURL : function() {
    var section = window.location.href.toQueryParams().section;
    var document = XWiki.currentDocument;
    var queryString;
    if (section) {
      var docRef = XWiki.getResource(section);
      document = new XWiki.Document(docRef.name, docRef.space, docRef.wiki);
      queryString = 'section=' + encodeURIComponent(section);
    }
    var action = XWiki.contextaction == 'view' || XWiki.contextaction == 'admin' ? 'get' : XWiki.contextaction;
    return document.getURL(action, queryString);
  },

  _onCheckForUpdates : function(event) {
    event.stop();
    this._refresh({
      'action': 'checkForUpdates',
      'xredirect': this._getRefreshURL()
    });
  }
});


var enhanceExtensions = function(event) {
  ((event && event.memo.elements) || [$('body')]).each(function(element) {
    element.select('.extension-item').each(function(extension) {
      !extension._extensionBehaviour && new XWiki.ExtensionBehaviour(extension);
    });
  });
};
var init = function(event) {
  $('extensionUpdater') && new XWiki.ExtensionUpdaterBehaviour($('extensionUpdater'));
  new XWiki.ExtensionSearchFormBehaviour();
  enhanceExtensions(event);
  return true;
};
// When the document is loaded, trigger the Extension Manager form enhancements.
(XWiki.domIsLoaded && init()) || document.observe("xwiki:dom:loaded", init);
document.observe('xwiki:dom:updated', enhanceExtensions);

// End XWiki augmentation.
return XWiki;
}(XWiki || {}));
