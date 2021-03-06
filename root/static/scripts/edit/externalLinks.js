// This file is part of MusicBrainz, the open internet music database.
// Copyright (C) 2014 MetaBrainz Foundation
// Licensed under the GPL version 2, or (at your option) any later version:
// http://www.gnu.org/licenses/gpl-2.0.txt

(function (externalLinks) {

    externalLinks.Relationship = aclass(MB.entity.Relationship, {

        around$init: function (supr, data, viewModel) {
            var source = viewModel.source;
            var forward = source.type < "url";

            data[forward ? "type1" : "type0"] = "url";
            data[forward ? "type0" : "type1"] = source.type;

            data.entity0ID = data.entity0ID || (forward ? source.gid : "");
            data.entity1ID = data.entity1ID || (forward ? "" : source.gid);

            supr(data);

            if (!source.gid) {
                this[forward ? "entity0Preview" : "entity1Preview"] = source.name;
            }

            this.viewModel = viewModel;
            this.original = MB.edit.fields.relationship(this);

            this.url = this.type1 === "url" ? this.entity1ID : this.entity0ID;
            this.label = ko.observable("");
            this.linkTypeDescription = ko.observable("");
            this.faviconClass = ko.observable("");
            this.error = (viewModel.errorType || ko.observable)("");
            this.removed = ko.observable(!!data.removed);
            this.removeButtonFocused = ko.observable(false);

            this.url.subscribe(this.urlChanged, this);
            this.linkTypeID.subscribe(this.linkTypeIDChanged, this);
        },

        urlChanged: function (value) {
            if (!this.error()) {
                var key, class_, classes = externalLinks.faviconClasses;

                for (key in classes) {
                    if (value.indexOf(key) > 0) {
                        this.faviconClass(classes[key] + "-favicon");
                        return;
                    }
                }
            }
            this.faviconClass("");
            this.viewModel.ensureOneEmptyLinkExists(this);
        },

        linkTypeIDChanged: function (value) {
            var typeInfo = externalLinks.typeInfo[value];

            if (typeInfo) {
                this.label(typeInfo.phrase);

                this.linkTypeDescription(
                    MB.i18n.expand(MB.text.MoreDocumentation, {
                        description: typeInfo.description,
                        url: "/relationship/" + typeInfo.gid
                    })
                );

                if (typeInfo.deprecated == 1) {
                    this.cleanup.error(MB.text.RelationshipTypeDeprecated);
                }
                else if (this.cleanup.error() === MB.text.RelationshipTypeDeprecated) {
                    this.cleanup.error("");
                }
            }
            else {
                this.label("");
                this.linkTypeDescription("");
            }
            this.viewModel.ensureOneEmptyLinkExists(this);
        },

        matchesType: function () {
            var currentType = this.linkTypeID();
            var guessedType = this.cleanup.guessType(this.viewModel.source.type, this.url());

            return currentType == guessedType;
        },

        showTypeSelection: function () {
            var hasError = !!this.error();
            var hasMatch = this.matchesType();
            var isEmpty = this.isEmpty();

            return hasError || !(hasMatch || isEmpty);
        },

        remove: function () {
            var linksArray = _.reject(this.viewModel.links(), function (link) {
                return link.removed() || link.isEmpty();
            });

            var index = linksArray.indexOf(this);

            if (this.id) {
                this.removed(true);

                // The original data won't be used, but the new data could
                // have errors that prevents everything from validating, so
                // we have to revert it.
                this.linkTypeID(this.original.link_type);
                this.entity0ID(this.original.entity0);
                this.entity1ID(this.original.entity1);
            }
            else {
                // this.cleanup is undefined for tests that don't deal with
                // markup (since it's set by the urlCleanup bindingHandler).
                this.cleanup && this.cleanup.toggleEvents("off");
                this.viewModel.links.remove(this);
            }

            // Clear errors so the form can be submitted (MBS-7340).
            this.error("");

            var linkToFocus = linksArray[index + 1] || linksArray[index - 1];

            if (linkToFocus) {
                linkToFocus.removeButtonFocused(true);
            }
            else {
                $("#add-external-link").focus();
            }

            this.viewModel.ensureOneEmptyLinkExists();
        },

        isEmpty: function () {
            return !(this.linkTypeID() || this.url());
        },

        isOnlyLink: function () {
            var links = this.viewModel.links();
            return links.length === 1 && links[0] === this;
        }
    });


    externalLinks.ViewModel = aclass({

        init: function (options) {
            this.formName = options.formName;
            this.source = options.source;
            this.errorType = options.errorType;

            this.links = ko.observableArray([]);
            this.addLinks(options.relationships, options.fieldErrors);

            this.bubbleDoc = MB.Control.BubbleDoc("Information")
            .extend({
                canBeShown: function (link) {
                    var url = link.url();

                    // Theoretically, if the URL isn't valid then the URLCleanup
                    // should've set an error. However, this callback runs before
                    // the URLCleanup code kicks in, so we need to check ourselves.
                    return (url && MB.utility.isValidURL(url) && !link.error()) ||
                        link.linkTypeDescription();
                }
            });
        },

        addLinks: function (relationships, fieldErrors) {
            fieldErrors = fieldErrors || [];

            function addRelationship(data, index) {
                var link = externalLinks.Relationship(data, this);
                var errors = fieldErrors[index];

                if (errors) {
                    if (errors.text) {
                        link.error(errors.text);
                    }
                    else if (errors.link_type_id) {
                        link.error(errors.link_type_id);
                    }
                }
                return link;
            }

            this.links.push.apply(this.links, _.map(relationships, addRelationship, this));
            this.ensureOneEmptyLinkExists();
            this.sortLinks();
        },

        hiddenInputs: function () {
            var fieldPrefix = this.formName + ".url";

            return _.flatten(_.map(this.links(), function (link, index) {
                var prefix = fieldPrefix + "." + index;
                var hidden = [];

                if (link.id) {
                    hidden.push({ name: prefix + ".relationship_id", value: link.id });
                }

                if (link.removed()) {
                    hidden.push({ name: prefix + ".removed", value: 1 });
                }
                else {
                    hidden.push({ name: prefix + ".text", value: link.url() });
                }

                hidden.push({ name: prefix + ".link_type_id", value: link.linkTypeID() });
                return hidden;
            }));
        },

        ensureOneEmptyLinkExists: function (activeLink) {
            var emptyLinks = _.filter(
                this.links(), function (link) { return link.isEmpty() }
            );

            if (!emptyLinks.length) {
                this.links.push(externalLinks.Relationship({}, this));
            }
            else if (emptyLinks.length > 1) {
                _(emptyLinks).without(activeLink).invoke("remove");
            }
        },

        sortLinks: function () {
            this.links(_(this.links())
                .sortBy(function (link) { return link.label().toLowerCase() })
                .sortBy(function (link) { return link.isEmpty() })
                .value()
            );
        }
    });


    externalLinks.init = function (options) {
        var containerNode = $("#external-links-editor")[0];
        var bubbleNode = $("#external-link-bubble")[0];
        var viewModel = this.ViewModel(options);

        ko.applyBindingsToNode(containerNode, {
            delegatedHandler: "click",
            affectsBubble: viewModel.bubbleDoc
        }, viewModel);

        ko.applyBindings(viewModel, containerNode);
        ko.applyBindingsToNode(bubbleNode, { bubble: viewModel.bubbleDoc }, viewModel);

        return viewModel;
    };

}(MB.Control.externalLinks = MB.Control.externalLinks || {}));


// Applies MB.Control.URLCleanup to an element containing a <select>
// (for the link type) and a <input type="text"> (for the URL).

ko.bindingHandlers.urlCleanup = {

    init: function (element, valueAccessor, allBindings, viewModel) {
        var $element = $(element);
        var $textInput = $element.find("input[type=text]");

        var cleanup = MB.Control.URLCleanup(
            valueAccessor(),
            $element.find("select"),
            $textInput,
            viewModel.error,
            false // handleErrors
        );

        viewModel.cleanup = cleanup;
        viewModel.urlChanged(viewModel.url());
        viewModel.linkTypeIDChanged(viewModel.linkTypeID());

        // Force validation on any initial data in the fields, i.e. when seeding.
        // The _.defer is because the knockout bindings haven't applied yet.
        _.defer(function () { $textInput.change() });
    }
};
